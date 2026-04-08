'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const MISSION_ITEMS = [
  { category: "cell phone", name: "휴대폰", emoji: "📱" },
  { category: "cup", name: "컵", emoji: "☕" },
  { category: "mouse", name: "마우스", emoji: "🖱️" }
];

const GAME_DURATION = 30;
const TARGET_SIZE = 150;

export default function ObjectDetection() {
  // Model State
  const [isModelReady, setIsModelReady] = useState(false);
  const [error, setError] = useState(null);
  
  // Game State
  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [currentMission, setCurrentMission] = useState(null);
  const [targetArea, setTargetArea] = useState({ x: 100, y: 100 });
  const [showSuccess, setShowSuccess] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null);
  const loopRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);
  const confettiBoxRef = useRef(null);

  // 1. Audio Engine
  const initAudio = () => {
    if (audioCtxRef.current) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioCtxRef.current = new AudioCtx();
    masterGainRef.current = audioCtxRef.current.createGain();
    masterGainRef.current.gain.value = 0.2;
    masterGainRef.current.connect(audioCtxRef.current.destination);
  };

  const playTone = (freq, duration, type = "sine") => {
    if (!audioCtxRef.current || isMuted) return;
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    const osc = audioCtxRef.current.createOscillator();
    const gain = audioCtxRef.current.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtxRef.current.currentTime);
    gain.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, audioCtxRef.current.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtxRef.current.currentTime + duration);
    osc.connect(gain);
    gain.connect(masterGainRef.current);
    osc.start();
    osc.stop(audioCtxRef.current.currentTime + duration);
  };

  const playSequence = async (notes) => {
    for (const note of notes) {
        playTone(note.freq, note.duration);
        await new Promise(r => setTimeout(r, note.duration * 1000));
    }
  };

  // 1. Initialize Detector
  useEffect(() => {
    async function initDetector() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        detectorRef.current = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite",
            delegate: "GPU"
          },
          scoreThreshold: 0.3,
          runningMode: "VIDEO"
        });
        setIsModelReady(true);
      } catch (err) {
        console.error("Detector Loading Error:", err);
        setError("AI 모델 로딩 중 오류가 발생했습니다.");
      }
    }
    initDetector();

    return () => {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
      if (detectorRef.current) detectorRef.current.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 2. Camera Setup
  useEffect(() => {
    if (isModelReady) {
      async function setupCamera() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadeddata = () => {
              predictLoop();
            };
          }
        } catch (err) {
          console.error("Camera Error:", err);
          setError("카메라 접근 권한을 확인해 주세요.");
        }
      }
      setupCamera();
    }
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
         videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, [isModelReady]);

  // 3. Game Logic Functions
  const generateMission = useCallback(() => {
    const randomItem = MISSION_ITEMS[Math.floor(Math.random() * MISSION_ITEMS.length)];
    setCurrentMission(randomItem);

    if (videoRef.current) {
      const vw = videoRef.current.videoWidth || 640;
      const vh = videoRef.current.videoHeight || 480;
      const margin = 50;
      const maxX = vw - TARGET_SIZE - margin;
      const maxY = vh - TARGET_SIZE - margin;
      
      setTargetArea({
        x: Math.max(margin, Math.floor(Math.random() * maxX)),
        y: Math.max(margin, Math.floor(Math.random() * maxY))
      });
    }
  }, []);

  const startGame = () => {
    initAudio();
    setScore(0);
    setTimeLeft(GAME_DURATION);
    setIsGameOver(false);
    setIsPlaying(true);
    generateMission();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setIsPlaying(false);
          setIsGameOver(true);
          playSequence([{freq: 784, duration: 0.1}, {freq: 523, duration: 0.2}]);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const createConfetti = () => {
    if (!confettiBoxRef.current) return;
    const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#7B61FF", "#00AFFF"];
    for (let i = 0; i < 20; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti-item";
        piece.style.left = Math.random() * 100 + "%";
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 0.5 + "s";
        confettiBoxRef.current.appendChild(piece);
        setTimeout(() => piece.remove(), 2000);
    }
  };

  const handleSuccess = useCallback(() => {
    setScore(s => s + 1);
    setShowSuccess(true);
    createConfetti();
    playSequence([{freq: 523, duration: 0.1}, {freq: 659, duration: 0.1}, {freq: 784, duration: 0.1}]);
    setTimeout(() => setShowSuccess(false), 1000);
    generateMission();
  }, [generateMission]);

  // 4. Prediction Loop
  const predictLoop = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !detectorRef.current) return;

    const startTimeMs = performance.now();
    const detections = detectorRef.current.detectForVideo(videoRef.current, startTimeMs);

    drawResult(detections);
    loopRef.current = requestAnimationFrame(predictLoop);
  }, []);

  // 5. Drawing & Collision Detection
  const drawResult = useCallback((result) => {
    const canvas = canvasRef.current;
    if (!canvas || !videoRef.current) return;

    const ctx = canvas.getContext('2d');
    const vw = videoRef.current.videoWidth;
    const vh = videoRef.current.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    ctx.clearRect(0, 0, vw, vh);

    const allowedCategories = ["cell phone", "cup", "mouse"];

    result.detections.forEach(detection => {
      // 대소문자 문제 방지를 위해 무조건 소문자 변환
      const category = detection.categories[0].categoryName.toLowerCase();
      if (!allowedCategories.includes(category)) return;

      const { originX, originY, width, height } = detection.boundingBox;
      
      // Calculate Center Point
      const centerX = originX + width / 2;
      const centerY = originY + height / 2;

      // Draw Debug Dot (Red)
      ctx.fillStyle = "#FF0000";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
      ctx.fill();

      // Detection Box Styling
      ctx.strokeStyle = "#4ECDC4";
      ctx.lineWidth = 2;
      ctx.strokeRect(originX, originY, width, height);

      // Label Text (캔버스가 반전되어 있으므로 글씨를 다시 똑바로 뒤집어서 그림)
      ctx.save();
      ctx.translate(centerX, originY > 20 ? originY - 10 : originY + 20);
      ctx.scale(-1, 1);
      ctx.fillStyle = "#4ECDC4";
      ctx.font = "bold 16px Noto Sans KR";
      ctx.textAlign = "center";
      ctx.fillText(`${category} (${Math.round(detection.categories[0].score * 100)}%)`, 0, 0);
      ctx.restore();

      // 핵심 버그: 화면이 CSS scaleX(-1)로 좌우 반전되어 있으므로,
      // 실제 웹캠 좌표인 centerX는 화면상에서 (vw - centerX) 위치에 렌더링 됩니다.
      // 따라서 충돌 판정은 반전된 화면상 X 좌표인 visualX를 기준으로 계산해야 합니다.
      const visualX = vw - centerX;

      // Check Collision with Target Area if Playing
      if (isPlaying && currentMission && category === currentMission.category) {
        if (
          visualX >= targetArea.x && 
          visualX <= targetArea.x + TARGET_SIZE &&
          centerY >= targetArea.y && 
          centerY <= targetArea.y + TARGET_SIZE
        ) {
          handleSuccess();
        }
      }
    });
  }, [isPlaying, currentMission, targetArea, handleSuccess]);

  const timerWidth = (timeLeft / GAME_DURATION) * 100;

  return (
    <div className="game-container">
      <div className="game-header">
        <h1>📦 물건 이동 게임</h1>
        <p className="subtitle">AI가 인식하는 물체를 목표 영역으로 옮겨보세요!</p>
      </div>

      <div className="detector-card card">
        {!isModelReady && !error && (
          <div className="overlay dark">
            <div className="spinner"></div>
            <p>🔄 AI 모델 로딩 중...</p>
          </div>
        )}

        {isGameOver && (
          <div className="overlay dark fade-in">
            <div className="end-card">
              <h2>⏰ 게임 종료!</h2>
              <p className="final-score">최종 점수: {score}점</p>
              <button onClick={startGame} className="primary-btn">🔄 다시 하기</button>
            </div>
          </div>
        )}

        {!isPlaying && !isGameOver && isModelReady && (
          <div className="overlay">
            <button onClick={startGame} className="start-btn">🎮 게임 시작</button>
          </div>
        )}

        <div className="viewport-wrap">
          {/* Top Bar Overlay */}
          <div className="hud-top">
            <div className="mission-info">
              {isPlaying && currentMission && (
                <div className="mission-tag bounce">
                  <span>{currentMission.emoji} {currentMission.name}</span>을 목표 영역으로 이동!
                </div>
              )}
            </div>
            <div className="score-display">
              {score > 0 && <span className="score-num">{score}</span>}
            </div>
            <button 
              className={`mute-btn-mini ${isMuted ? 'muted' : ''}`}
              onClick={() => { initAudio(); setIsMuted(!isMuted); }}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
          </div>

          {/* Timer Bar */}
          <div className="timer-bar-bg">
            <div 
              className={`timer-fill ${timeLeft <= 10 ? 'warning blink' : ''}`} 
              style={{ width: `${timerWidth}%` }}
            ></div>
          </div>

          {/* Success Display */}
          {showSuccess && (
            <div className="success-pop">🎉 성공!</div>
          )}

          {/* Main Viewport */}
          <div className="viewport">
            <video ref={videoRef} playsInline muted autoPlay className="mirrored" />
            <canvas ref={canvasRef} className="mirrored" />
            
            {/* Target Area Box (Mirrored with video) */}
            {isPlaying && (
              <div 
                className="target-box pulse"
                style={{
                  position: 'absolute',
                  width: `${(TARGET_SIZE / 640) * 100}%`,
                  height: `${(TARGET_SIZE / 480) * 100}%`,
                  left: `${(targetArea.x / 640) * 100}%`,
                  top: `${(targetArea.y / 480) * 100}%`,
                  transform: 'scaleX(-1)' // Keep mirrored consistent
                }}
              ></div>
            )}
            <div ref={confettiBoxRef} className="confetti-container-mini"></div>
          </div>
        </div>

        <div className="info-footer">
          <div className="target-icons">
             인식 가능: 📱 ☕ 🖱️
          </div>
        </div>
      </div>

      <style jsx>{`
        .game-container { width: 100%; max-width: 800px; display: flex; flex-direction: column; gap: 1.5rem; }
        .game-header { text-align: center; }
        .detector-card { position: relative; padding: 1rem; background: white; overflow: hidden; }
        
        .viewport-wrap { position: relative; width: 100%; aspect-ratio: 4/3; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); background: #000; }
        .viewport { position: relative; width: 100%; height: 100%; }
        video, canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
        .mirrored { transform: scaleX(-1); }

        /* HUD Overlays */
        .hud-top { position: absolute; top: 1.5rem; left: 1.5rem; right: 1.5rem; z-index: 5; display: flex; justify-content: space-between; align-items: flex-start; }
        .mission-info { flex: 1; }
        .score-display { flex: 1; display: flex; justify-content: flex-end; margin-right: 0.8rem; }
        .mission-tag { background: white; color: var(--foreground); padding: 8px 16px; border-radius: 30px; font-weight: 700; box-shadow: var(--shadow-md); font-size: 1rem; border: 2px solid var(--border); }
        .score-num { font-size: 3rem; color: #FFD700; font-weight: 900; text-shadow: 0 4px 10px rgba(0,0,0,0.3); line-height: 1; }
        
        .mute-btn-mini { background: white; border: 1px solid var(--border); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1.1rem; box-shadow: var(--shadow-sm); z-index: 10; }
        .mute-btn-mini:hover { transform: scale(1.1); }
        .mute-btn-mini.muted { opacity: 0.5; }

        .timer-bar-bg { position: absolute; top: 0; left: 0; width: 100%; height: 8px; background: rgba(255,255,255,0.2); z-index: 6; }
        .timer-fill { height: 100%; background: #4ECDC4; transition: width 1s linear; }
        .timer-fill.warning { background: #FF6B6B; }

        .target-box { border: 3px dashed #4ECDC4; background: rgba(78, 205, 196, 0.15); border-radius: 8px; z-index: 4; }

        .success-pop { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10; font-size: 4rem; font-weight: 900; color: #white; text-shadow: 0 0 20px rgba(78,205,196,0.8); animation: bounce 0.5s ease; }

        .overlay { position: absolute; inset: 0; z-index: 20; background: rgba(255,255,255,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; }
        .overlay.dark { background: rgba(0,0,0,0.7); color: white; backdrop-filter: blur(10px); }
        
        .end-card { text-align: center; }
        .final-score { font-size: 2.5rem; font-weight: 900; margin: 1rem 0 2rem; color: #FFD700; }
        
        .primary-btn, .start-btn { background: var(--foreground); color: white; border: none; padding: 16px 40px; border-radius: 40px; font-size: 1.2rem; font-weight: 700; cursor: pointer; box-shadow: 0 10px 20px rgba(0,0,0,0.2); transition: transform 0.2s; }
        .primary-btn:hover, .start-btn:hover { transform: scale(1.05); }

        .info-footer { margin-top: 1rem; color: var(--text-secondary); font-size: 0.9rem; text-align: center; }

        /* Animations */
        .pulse { animation: pulse 1.5s infinite; }
        @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 0.8; transform: scaleX(-1) scale(1.05); } 100% { opacity: 0.4; } }
        
        .blink { animation: blink 0.5s infinite; }
        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

        .bounce { animation: bounce 0.5s ease; }
        @keyframes bounce { 0% { transform: scale(0.8); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }

        .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2); border-top-color: #4ECDC4; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .confetti-container-mini { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; }
        :global(.confetti-item) { position: absolute; width: 12px; height: 12px; top: -20px; animation: fall-mini 2s ease-in forwards; }
        @keyframes fall-mini {
          0% { transform: translateY(0) rotate(0); opacity: 1; }
          100% { transform: translateY(500px) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
