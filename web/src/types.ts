export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/** 자비스 상태바가 표현하는 상태 (기획서 §화면 상태). */
export type JarvisStatus =
  | 'idle' // 대기
  | 'listening' // 청취 (M5 음성에서 사용, 지금은 자리만)
  | 'thinking' // 사고·생성
  | 'rendering' // 렌더 (M3 HUD에서 사용, 지금은 자리만)
  | 'warning'; // 경고/에러
