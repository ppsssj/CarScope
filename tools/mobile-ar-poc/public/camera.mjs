export function cameraError(error) {
  const messages = {
    NotFoundError: '사용 가능한 카메라가 없습니다.',
    NotReadableError: '카메라가 사용 중이거나 읽을 수 없습니다.',
    OverconstrainedError: '요청한 카메라 조건을 지원하지 않습니다.'
  };
  if (error?.name === 'NotAllowedError') return '카메라 권한이 거부되었거나 브라우저에서 차단했습니다.';
  return messages[error?.name] || '카메라 실행에 실패했습니다. 수동 안내를 사용하세요.';
}

export class CameraSession {
  constructor(video, mediaDevices, onEnded = () => {}) {
    this.video = video;
    this.mediaDevices = mediaDevices;
    this.onEnded = onEnded;
    this.generation = 0;
    this.stream = null;
  }
  stop() {
    this.generation++;
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
  }
  async start() {
    this.stop();
    const generation = this.generation;
    const stream = await this.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    if (generation !== this.generation) {
      stream.getTracks().forEach(track => track.stop());
      return false;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    for (const track of stream.getTracks()) track.addEventListener('ended', () => {
      if (generation === this.generation) { this.stop(); this.onEnded(); }
    }, { once: true });
    try { await this.video.play(); }
    catch (error) { if (generation === this.generation) this.stop(); throw error; }
    return generation === this.generation;
  }
}
