#!/usr/bin/env python3
"""
음성 파이프라인 스모크 테스트 — faster-whisper(STT) -> LLM -> ElevenLabs(TTS)
M0 de-risk 용. 목적은 "예쁜 비서"가 아니라 단계별 지연을 재서 0.5초 목표까지
거리를 눈으로 확인하는 것.

설치(권장: WSL2 또는 로컬 파이썬 3.10~3.11):
    pip install faster-whisper sounddevice numpy elevenlabs requests

환경변수:
    export ELEVENLABS_API_KEY=...          # 필수 (--llm none 이라도 TTS는 필요)
    export ELEVENLABS_VOICE_ID=...         # 자비스 보이스 ID (라이브러리에서 복사)

사용 예:
    # 마이크로 5초 녹음 -> Ollama 로컬 LLM -> TTS
    python voice_smoke_test.py --seconds 5 --llm ollama --llm-model qwen2.5:7b

    # LLM 빼고 STT+TTS 지연만 격리 측정 (transcript를 그대로 읽어줌)
    python voice_smoke_test.py --seconds 5 --llm none

    # 미리 녹음한 wav로 결정론적 측정
    python voice_smoke_test.py --wav sample_ko.wav --llm none
"""
import argparse, os, sys, time, wave
from contextlib import contextmanager

SR = 16000  # whisper 입력 샘플레이트


@contextmanager
def stage(name, store):
    t0 = time.perf_counter()
    yield
    dt = time.perf_counter() - t0
    store[name] = dt
    print(f"  [{name:<14}] {dt*1000:7.0f} ms")


def record_mic(seconds):
    import sounddevice as sd
    import numpy as np
    print(f"🎤  {seconds}초간 말하세요...")
    for i in range(seconds, 0, -1):
        sys.stdout.write(f"\r    녹음 중 {i}s "); sys.stdout.flush(); time.sleep(1)
    print("\r    녹음 완료      ")
    audio = sd.rec(int(seconds * SR), samplerate=SR, channels=1, dtype="float32")
    sd.wait()
    return audio.flatten()


def load_wav(path):
    import numpy as np
    with wave.open(path, "rb") as w:
        n, sr = w.getnframes(), w.getframerate()
        raw = w.readframes(n)
    a = np.frombuffer(raw, dtype=np.int16).astype("float32") / 32768.0
    if sr != SR:
        print(f"⚠️  wav 샘플레이트 {sr} != {SR}. 16kHz mono wav 권장.")
    return a


def transcribe(model, audio, language):
    segments, info = model.transcribe(
        audio, language=language, beam_size=1, vad_filter=True
    )
    text = "".join(seg.text for seg in segments).strip()
    return text


def llm_ollama(prompt, model):
    import requests
    sys_msg = "You are JARVIS. Reply in ONE short sentence, same language as the user."
    r = requests.post(
        "http://localhost:11434/api/chat",
        json={"model": model, "stream": False,
              "messages": [{"role": "system", "content": sys_msg},
                           {"role": "user", "content": prompt}]},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()["message"]["content"].strip()


def tts_first_chunk(text, store):
    """ElevenLabs Flash v2.5로 합성하면서 '첫 오디오 청크까지' 시간(TTFA)을 잰다.
    음성은 듣는 속도에 묶이므로 raw 생성속도보다 이 TTFA가 체감 지연의 핵심."""
    from elevenlabs.client import ElevenLabs
    import numpy as np

    client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
    voice_id = os.environ["ELEVENLABS_VOICE_ID"]
    kwargs = dict(voice_id=voice_id, model_id="eleven_flash_v2_5",
                  text=text, output_format="pcm_24000")

    # SDK 버전에 따라 메서드명이 다름 -> 방어적으로 stream/convert 모두 시도
    if hasattr(client.text_to_speech, "stream"):
        gen = client.text_to_speech.stream(**kwargs)
    else:
        gen = client.text_to_speech.convert(**kwargs)

    chunks, t0, ttfa = [], time.perf_counter(), None
    for c in gen:
        if ttfa is None:
            ttfa = time.perf_counter() - t0
            store["tts_first_audio"] = ttfa
            print(f"  [tts_first_audio] {ttfa*1000:7.0f} ms  <- TTFA (체감 지연 핵심)")
        chunks.append(c)
    store["tts_total"] = time.perf_counter() - t0
    print(f"  [tts_total     ] {store['tts_total']*1000:7.0f} ms")
    return b"".join(chunks)


def play_pcm(pcm_bytes):
    import sounddevice as sd
    import numpy as np
    arr = np.frombuffer(pcm_bytes, dtype=np.int16)
    print("🔊  재생...")
    sd.play(arr, 24000); sd.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=5, help="마이크 녹음 길이")
    ap.add_argument("--wav", help="마이크 대신 사용할 wav 경로(16kHz mono)")
    ap.add_argument("--model", default="small", help="faster-whisper 모델 (small/medium/large-v3)")
    ap.add_argument("--device", default="cuda", help="cuda 또는 cpu")
    ap.add_argument("--language", default=None, help="ko/en. 미지정시 자동감지")
    ap.add_argument("--llm", choices=["ollama", "none"], default="ollama")
    ap.add_argument("--llm-model", default="qwen2.5:7b")
    ap.add_argument("--no-play", action="store_true", help="재생 생략")
    args = ap.parse_args()

    if "ELEVENLABS_API_KEY" not in os.environ or "ELEVENLABS_VOICE_ID" not in os.environ:
        sys.exit("환경변수 ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID 가 필요합니다.")

    times = {}
    print("\n=== 음성 파이프라인 스모크 테스트 ===")

    # 0) 입력 오디오
    audio = load_wav(args.wav) if args.wav else record_mic(args.seconds)

    # 1) STT (로컬, faster-whisper)
    from faster_whisper import WhisperModel
    print("STT 모델 로딩...")
    t0 = time.perf_counter()
    model = WhisperModel(args.model, device=args.device, compute_type="float16" if args.device=="cuda" else "int8")
    print(f"  (모델 로드 {time.perf_counter()-t0:.1f}s, 측정엔 미포함)")

    with stage("stt", times):
        transcript = transcribe(model, audio, args.language)
    print(f"  USER> {transcript!r}")
    if not transcript:
        sys.exit("STT 결과가 비었습니다. 마이크/오디오를 확인하세요.")

    # 2) LLM
    if args.llm == "none":
        response = transcript  # STT+TTS 지연 격리용: 들은 걸 그대로 읽음
        times["llm"] = 0.0
        print("  (LLM 생략 — transcript를 그대로 응답으로 사용)")
    else:
        with stage("llm", times):
            response = llm_ollama(transcript, args.llm_model)
    print(f"  JARVIS> {response!r}")

    # 3) TTS (ElevenLabs Flash v2.5) — TTFA 측정
    pcm = tts_first_chunk(response, times)

    # 4) 재생
    if not args.no_play:
        play_pcm(pcm)

    # 요약
    user_perceived = times.get("stt",0) + times.get("llm",0) + times.get("tts_first_audio",0)
    print("\n--- 요약 ---")
    print(f"  STT            : {times.get('stt',0)*1000:7.0f} ms")
    print(f"  LLM            : {times.get('llm',0)*1000:7.0f} ms")
    print(f"  TTS TTFA       : {times.get('tts_first_audio',0)*1000:7.0f} ms")
    print(f"  ─ 체감 왕복(첫 소리까지): {user_perceived*1000:7.0f} ms   (목표 ~500 ms)")
    gap = user_perceived - 0.5
    verdict = "✅ 목표 근접/달성" if gap <= 0 else f"⚠️  목표 대비 +{gap*1000:.0f} ms — 스트리밍 중첩 필요"
    print(f"  판정          : {verdict}")
    print("\n참고: 위는 순차 측정. 실제 M5에서는 STT 부분결과→LLM 토큰→TTS 청크를")
    print("      겹쳐 흘려보내(streaming overlap) 첫 소리까지를 더 줄인다.\n")


if __name__ == "__main__":
    main()
