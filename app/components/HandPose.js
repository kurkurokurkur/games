'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MISSIONS = [
  { id: "👌 OK", name: "OK" },
  { id: "✌️ V", name: "V" },
  { id: "👍 엄지척", name: "엄지척" },
  { id: "✊ 주먹", name: "주먹" },
  { id: "🖐 보", name: "보" }
];
const GAME_DURATION = 30;

export default function HandPose() {
  const [isModelReady, setIsModelReady] = useState(false);
  const [error, setError] = useState(null);
  const [debugData, setDebugData] = useState([]);
  
  // Game States
  const [activeTab, setActiveTab] = useState('기본');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [currentMission, setCurrentMission] = useState(null);
  const [progress, setProgress] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const loopRef = useRef(null);

  const historyRef = useRef({ Left: [], Right: [] });
  const gestureHistoryRef = useRef({ Left: [], Right: [] });

  // Game Logic Refs
  const timerRef = useRef(null);
  const progressRef = useRef(0);
  const lastTimeRef = useRef(0);
  const showSuccessRef = useRef(false);
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);
  const confettiBoxRef = useRef(null);
  const isPlayingRef = useRef(false);
  const currentMissionRef = useRef(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    currentMissionRef.current = currentMission;
  }, [isPlaying, currentMission]);

  // Audio Init
  const initAudio = () => {
    if (audioCtxRef.current) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioCtxRef.current = new AudioCtx();
    masterGainRef.current = audioCtxRef.current.createGain();
    masterGainRef.current.gain.value = 0.2;
    masterGainRef.current.connect(audioCtxRef.current.destination);
  };

  const playSequence = async (notes) => {
    if (!audioCtxRef.current || isMuted) return;
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    for (const note of notes) {
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        osc.frequency.setValueAtTime(note.freq, audioCtxRef.current.currentTime);
        gain.gain.setValueAtTime(0.3, audioCtxRef.current.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtxRef.current.currentTime + note.duration);
        osc.connect(gain);
        gain.connect(masterGainRef.current);
        osc.start();
        osc.stop(audioCtxRef.current.currentTime + note.duration);
        await new Promise(r => setTimeout(r, note.duration * 1000));
    }
  };

  const createConfetti = () => {
    if (!confettiBoxRef.current) return;
    const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#7B61FF", "#00AFFF"];
    for (let i = 0; i < 30; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti-item";
        piece.style.left = Math.random() * 100 + "%";
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 0.2 + "s";
        confettiBoxRef.current.appendChild(piece);
        setTimeout(() => piece.remove(), 2000);
    }
  };

  const handleSuccess = useCallback(() => {
    showSuccessRef.current = true;
    setShowSuccess(true);
    setScore(s => s + 1);
    createConfetti();
    playSequence([{freq: 523, duration: 0.1}, {freq: 659, duration: 0.1}, {freq: 784, duration: 0.2}]);
    
    setTimeout(() => {
      progressRef.current = 0;
      setProgress(0);
      setShowSuccess(false);
      showSuccessRef.current = false;
      const nextMission = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
      setCurrentMission(nextMission);
    }, 1000);
  }, []);

  const startGame = () => {
    initAudio();
    setIsPlaying(true);
    setIsGameOver(false);
    setScore(0);
    setTimeLeft(GAME_DURATION);
    progressRef.current = 0;
    setProgress(0);
    const firstMission = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
    setCurrentMission(firstMission);

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

  // 1. Initialize Hand Landmarker Model
  useEffect(() => {
    async function initHandLandmarker() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2
        });
        setIsModelReady(true);
      } catch (err) {
        console.error("Model Loading Error:", err);
        setError("AI 모델 로딩 중 오류가 발생했습니다.");
      }
    }
    initHandLandmarker();

    return () => {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
      if (landmarkerRef.current) landmarkerRef.current.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 2. Setup Camera
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
              lastTimeRef.current = performance.now();
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

  // 3. Prediction Loop
  const predictLoop = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !landmarkerRef.current) return;
    
    if (videoRef.current.readyState >= 2) {
      const startTimeMs = performance.now();
      const results = landmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
      drawResult(results);
    }
    loopRef.current = requestAnimationFrame(predictLoop);
  }, []);

  // 4. Drawing Results
  const drawResult = useCallback((results) => {
    const canvas = canvasRef.current;
    if (!canvas || !videoRef.current) return;

    const ctx = canvas.getContext('2d');
    const vw = videoRef.current.videoWidth;
    const vh = videoRef.current.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    
    ctx.clearRect(0, 0, vw, vh);

    const currentDebugData = [];
    let isMissionMatched = false;

    if (results.landmarks && results.landmarks.length > 0) {
      for (let i = 0; i < results.landmarks.length; i++) {
        const landmarks = results.landmarks[i];
        const handedness = results.handednesses[i][0].categoryName;
        const text = handedness === "Left" ? "왼손" : "오른손";

        ctx.strokeStyle = '#7B61FF';
        ctx.lineWidth = 2;

        const connect = (p1, p2) => {
          if(!landmarks[p1] || !landmarks[p2]) return;
          ctx.beginPath();
          ctx.moveTo(landmarks[p1].x * vw, landmarks[p1].y * vh);
          ctx.lineTo(landmarks[p2].x * vw, landmarks[p2].y * vh);
          ctx.stroke();
        };

        connect(0,1); connect(1,2); connect(2,3); connect(3,4);
        connect(0,5); connect(5,6); connect(6,7); connect(7,8);
        connect(0,9); connect(9,10); connect(10,11); connect(11,12);
        connect(0,13); connect(13,14); connect(14,15); connect(15,16);
        connect(0,17); connect(17,18); connect(18,19); connect(19,20);
        connect(5,9); connect(9,13); connect(13,17);

        ctx.fillStyle = '#00AFFF';
        for (const landmark of landmarks) {
          ctx.beginPath();
          ctx.arc(landmark.x * vw, landmark.y * vh, 5, 0, 2 * Math.PI);
          ctx.fill();
        }

        ctx.save();
        const wrist = landmarks[0];
        const textX = wrist.x * vw;
        const textY = wrist.y * vh + 40;
        
        ctx.translate(textX, textY);
        ctx.scale(-1, 1);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 24px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.fillText(text, 0, 0);
        ctx.restore();

        // 디버깅 및 판별 로직
        const x5 = landmarks[5].x;
        const x17 = landmarks[17].x;
        let isPalm = false;
        if (handedness === "Right") { isPalm = x5 > x17; } else { isPalm = x5 < x17; }

        const rawStretched = [];
        const fingerDetails = [];

        const tTip = landmarks[4].x;
        const tIp = landmarks[3].x;
        let isThumbStretched = false;
        let tCmp = ""; 
        if (handedness === "Right") {
          if (isPalm) { isThumbStretched = tTip > tIp; tCmp = ">"; } else { isThumbStretched = tTip < tIp; tCmp = "<"; }
        } else {
          if (isPalm) { isThumbStretched = tTip < tIp; tCmp = "<"; } else { isThumbStretched = tTip > tIp; tCmp = ">"; }
        }
        
        rawStretched.push(isThumbStretched);
        fingerDetails.push({ name: "엄지", j1Url: 4, j2Url: 3, v1: tTip.toFixed(3), v2: tIp.toFixed(3), cmp: tCmp });

        const others = [
          { name: "검지", tip: 8, pip: 6 },
          { name: "중지", tip: 12, pip: 10 },
          { name: "약지", tip: 16, pip: 14 },
          { name: "새끼", tip: 20, pip: 18 }
        ];

        others.forEach(finger => {
          const tipY = landmarks[finger.tip].y;
          const pipY = landmarks[finger.pip].y;
          const isStretched = tipY < pipY;
          rawStretched.push(isStretched);
          fingerDetails.push({ name: finger.name, j1Url: finger.tip, j2Url: finger.pip, v1: tipY.toFixed(3), v2: pipY.toFixed(3), cmp: "<" });
        });

        const hist = historyRef.current[handedness];
        hist.push(rawStretched);
        if (hist.length > 3) hist.shift();

        const needed = hist.length === 3 ? 2 : hist.length === 2 ? 2 : 1;
        const finalStretched = [];

        for (let f = 0; f < 5; f++) {
          let trueCount = 0;
          for (let h = 0; h < hist.length; h++) { if (hist[h][f]) trueCount++; }
          const isFinalTrue = trueCount >= needed;
          finalStretched.push(isFinalTrue);
          fingerDetails[f].final = isFinalTrue;
        }

        const stretchedCount = finalStretched.filter(v => v).length;

        const [thumb, index, middle, ring, pinky] = finalStretched;
        const dx = landmarks[4].x - landmarks[8].x;
        const dy = landmarks[4].y - landmarks[8].y;
        const MathDist = Math.sqrt(dx * dx + dy * dy);

        let currentGesture = "✨ 자유 제스처";
        if (MathDist <= 0.06 && middle && ring && pinky) { currentGesture = "👌 OK"; }
        else if (!thumb && index && middle && !ring && !pinky) { currentGesture = "✌️ V"; }
        else if (thumb && !index && !middle && !ring && !pinky) { currentGesture = "👍 엄지척"; }
        else if (stretchedCount === 0) { currentGesture = "✊ 주먹"; }
        else if (stretchedCount === 5) { currentGesture = "🖐 보"; }

        const gHist = gestureHistoryRef.current[handedness];
        gHist.push(currentGesture);
        if (gHist.length > 5) gHist.shift();

        const counts = {};
        let maxCount = 0;
        let finalGesture = currentGesture;

        for (const g of gHist) {
          counts[g] = (counts[g] || 0) + 1;
          if (counts[g] > maxCount) {
            maxCount = counts[g];
            finalGesture = g;
          }
        }

        if (finalGesture === currentMissionRef.current?.id) {
          isMissionMatched = true;
        }

        currentDebugData.push({
          handedness, isPalm, fingerDetails, stretchedCount,
          finalGesture, maxCount, totalFrames: gHist.length
        });
      }
    } else {
      historyRef.current = { Left: [], Right: [] };
      gestureHistoryRef.current = { Left: [], Right: [] };
    }
    
    // 게임 로직 (유지 게이지)
    const now = performance.now();
    const dt = lastTimeRef.current ? now - lastTimeRef.current : 0;
    lastTimeRef.current = now;

    if (isPlayingRef.current && currentMissionRef.current && !showSuccessRef.current) {
        let newProgress = progressRef.current;
        if (isMissionMatched) {
            newProgress += (dt / 3000) * 100; // 3초 소요
        } else {
            newProgress -= (dt / 6000) * 100; // 6초간 감쇠 (천천히)
        }
        
        if (newProgress < 0) newProgress = 0;
        if (newProgress >= 100) {
            newProgress = 100;
            handleSuccess();
        }
        
        progressRef.current = newProgress;
    }

    setDebugData(currentDebugData);
    setProgress(progressRef.current);
  }, []);

  return (
    <div className="game-container full-width">
      <div className="handpose-layout">
        
        {/* Left: Webcam tracking area */}
        <div className="webcam-section">
          <div className="game-header">
            <h1>✋ 핸드포즈 챌린지</h1>
            <p className="subtitle">MediaPipe를 이용해 손 제스처를 완성하세요!</p>
          </div>

          <div className="detector-card card">
            {!isModelReady && !error && (
              <div className="overlay dark">
                <div className="spinner"></div>
                <p>🔄 AI 모델 로딩 중...</p>
              </div>
            )}
            {error && (
                <div className="overlay dark">
                    <p>⚠️ {error}</p>
                </div>
            )}

            <div className="viewport-wrap">
              <div className="viewport">
                <video ref={videoRef} playsInline muted autoPlay className="mirrored" />
                <canvas ref={canvasRef} className="mirrored" />
                
                {/* 멀티 모드일 때 여러 손 제스처 표시 */}
                {debugData.length > 0 && (
                  <div className="gestures-container">
                    {debugData.map((data, idx) => (
                      <div key={idx} className={`gesture-badge bounce ${data.finalGesture === currentMission?.id ? 'success-match' : ''}`}>
                        {data.handedness === 'Left' ? '🖐️ L ' : '🖐️ R '} 
                        {data.finalGesture}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 디버깅 디스플레이 (테이블) */}
            {debugData.length > 0 && (
              <div className="debug-container">
                {debugData.map((data, idx) => (
                  <div key={idx} className="debug-table-wrapper">
                    <table className="debug-table">
                      <thead>
                        <tr>
                          <th>손가락</th><th>관절1 좌표</th><th>관절2 좌표</th><th>비교</th><th>결과</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.fingerDetails.map((f, j) => (
                          <tr key={j}>
                            <td>{f.name}</td>
                            <td>TIP({f.j1Url}): {f.v1}</td>
                            <td>{f.name === '엄지' ? 'IP' : 'PIP'}({f.j2Url}): {f.v2}</td>
                            <td>TIP {f.cmp} {f.name === '엄지' ? 'IP' : 'PIP'}</td>
                            <td style={{ color: f.final ? '#4ECDC4' : '#FF6B6B' }}>
                              {f.final ? '펴짐 🟢' : '접힘 🔴'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="debug-footer">
                      손바닥/손등: <span className="highlight">{data.isPalm ? '손바닥' : '손등'}</span> | 
                      handedness: <span className="highlight">{data.handedness}</span> | 
                      펴진 손가락: <span className="highlight">{data.stretchedCount}개/5개</span> | 
                      확정: <span className="highlight gesture-result">{data.finalGesture} ({data.maxCount}/{data.totalFrames}프레임)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Game Panel */}
        <div className="game-panel card">
          <div className="tabs">
            <button className={activeTab === '기본' ? 'active' : ''} onClick={() => setActiveTab('기본')}>🎯 기본 제스처</button>
            <button className={activeTab === '커스텀' ? 'active' : ''} onClick={() => setActiveTab('커스텀')}>✨ 나만의 제스처</button>
          </div>

          <button className={`mute-btn-mini ${isMuted ? 'muted' : ''}`} onClick={() => { initAudio(); setIsMuted(!isMuted); }}>
              {isMuted ? '🔇' : '🔊'}
          </button>

          {activeTab === '커스텀' ? (
            <div className="placeholder fadeIn">개발 중인 기능입니다.</div>
          ) : (
            <div className="game-content">
              {!isPlaying && !isGameOver && (
                <div className="start-screen fadeIn">
                  <div className="mission-text">🏆</div>
                  <h2>제스처 마스터!</h2>
                  <p>30초 동안 제시된 미션을 따라하세요.</p>
                  <button className="primary-btn" onClick={startGame}>🎮 게임 시작</button>
                </div>
              )}

              {isGameOver && (
                <div className="end-screen fadeIn">
                  <h2>⏰ 게임 종료!</h2>
                  <p className="final-score">최종 점수: {score}점</p>
                  <button className="primary-btn" onClick={startGame}>🔄 다시 하기</button>
                </div>
              )}

              {isPlaying && !isGameOver && (
                <div className="playing-screen fadeIn">
                  <div className="hud-header">
                    <div className="score-box">점수: <span>{score}</span></div>
                    <div className={`timer-box ${timeLeft <= 10 ? 'warning blink' : ''}`}>⏱️ {timeLeft}초</div>
                  </div>

                  <div className="mission-display">
                     <h3>지금 미션!</h3>
                     <div className="mission-text">{currentMission?.id}</div>
                     <p className="mission-desc">제스처를 만들고 3초간 유지하세요!</p>
                  </div>

                  <div className="progress-section">
                     <div className="progress-label">유지 게이지 (3초)</div>
                     <div className={`progress-bar-bg ${progress > 80 ? 'glow' : ''}`}>
                       <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                     </div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Effects Layer */}
          <div ref={confettiBoxRef} className="confetti-container"></div>
          {showSuccess && <div className="success-pop">🎉 성공!</div>}
        </div>
      </div>

      <style jsx>{`
        .full-width { max-width: 1200px !important; margin: 0 auto; }
        .handpose-layout { display: flex; gap: 1.5rem; width: 100%; flex-wrap: wrap; }
        .webcam-section { flex: 1 1 600px; display: flex; flex-direction: column; gap: 1rem; }
        .game-panel { flex: 0 0 350px; display: flex; flex-direction: column; padding: 1.5rem; position: relative; overflow: hidden; height: fit-content; min-height: 500px; }

        .game-header { text-align: left; }
        .detector-card { position: relative; padding: 1rem; background: white; overflow: hidden; border-radius: 12px; }
        
        .viewport-wrap { position: relative; width: 100%; aspect-ratio: 4/3; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); background: #000; }
        .viewport { position: relative; width: 100%; height: 100%; }
        video, canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
        .mirrored { transform: scaleX(-1); }

        .overlay { position: absolute; inset: 0; z-index: 20; background: rgba(255,255,255,0.6); backdrop-filter: blur(4px); display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .overlay.dark { background: rgba(0,0,0,0.7); color: white; backdrop-filter: blur(10px); }

        .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2); border-top-color: #4ECDC4; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* 디버그 UI 스타일 */
        .debug-container { margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem; }
        .debug-table-wrapper { background: rgba(0, 0, 0, 0.7); color: #fff; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; width: 100%; border: 1px solid rgba(255,255,255,0.1); }
        .debug-table { width: 100%; table-layout: fixed; border-collapse: collapse; white-space: nowrap; margin-bottom: 8px; }
        .debug-table th, .debug-table td { border: 1px solid rgba(255, 255, 255, 0.2); padding: 6px; text-align: center; }
        .debug-table th { background: rgba(255, 255, 255, 0.1); font-weight: bold; color: #4ECDC4; }
        .debug-footer { text-align: center; font-weight: bold; font-size: 13px; color: white; padding-top: 4px; }
        .highlight { color: #FFD700; margin: 0 4px; }
        .gesture-result { color: #4ECDC4; }

        /* 제스처 오버레이 배지 스타일 */
        .gestures-container { position: absolute; top: 20px; left: 0; width: 100%; display: flex; justify-content: center; gap: 20px; z-index: 10; pointer-events: none; }
        .gesture-badge { background: rgba(0,0,0,0.6); padding: 10px 24px; border-radius: 40px; font-size: 2.5rem; font-weight: 800; color: white; border: 2px solid rgba(255,255,255,0.2); backdrop-filter: blur(5px); transition: all 0.3s ease; }
        .gesture-badge.success-match { background: rgba(78, 205, 196, 0.9); border-color: white; transform: scale(1.1); box-shadow: 0 0 20px rgba(78, 205, 196, 0.5); }
        .bounce { animation: bounceBadge 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards; }
        @keyframes bounceBadge { 0% { transform: scale(0.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

        /* --- 게임 패널 스타일 --- */
        .tabs { display: flex; gap: 0.5rem; margin-bottom: 2rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; }
        .tabs button { flex: 1; background: transparent; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; padding: 0.5rem; transition: all 0.2s; }
        .tabs button.active { color: #4ECDC4; border-bottom: 3px solid #4ECDC4; }

        .game-content { display: flex; flex-direction: column; flex: 1; justify-content: space-between; height: 100%; min-height: 400px;}
        .start-screen, .end-screen { text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 1rem; }
        .playing-screen { display: flex; flex-direction: column; height: 100%; }
        
        .final-score { font-size: 2.5rem; font-weight: 900; color: #FFD700; margin: 1rem 0 2rem; }

        .hud-header { display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.05); padding: 1rem; border-radius: 12px; margin-bottom: 2rem; }
        .score-box { font-size: 1.2rem; font-weight: bold; }
        .score-box span { color: #4ECDC4; font-size: 1.5rem; }
        .timer-box { font-size: 1.2rem; font-weight: bold; }
        .warning.blink { color: #FF6B6B; animation: blink 0.5s infinite; }

        .mission-display { text-align: center; margin-bottom: 3rem; flex: 1; display:flex; flex-direction:column; justify-content: center;}
        .mission-display h3 { color: var(--text-secondary); margin-bottom: 1rem; font-size: 1rem;}
        .mission-text { font-size: 4rem; font-weight: 900; line-height: 1.2; margin-bottom: 0.5rem; text-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        .mission-desc { font-size: 1rem; color: var(--text-secondary); }

        .progress-section { margin-top: auto; padding-top: 2rem;}
        .progress-label { font-size: 0.9rem; margin-bottom: 0.5rem; color: var(--text-secondary); font-weight: bold;}
        .progress-bar-bg { width: 100%; height: 24px; background: rgba(0,0,0,0.1); border-radius: 12px; overflow: hidden; position: relative; border: 1px solid var(--border); transition: box-shadow 0.3s; }
        .progress-bar-bg.glow { box-shadow: 0 0 15px rgba(78, 205, 196, 0.4); border-color: #4ECDC4; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #4ECDC4, #7B61FF); transition: width 0.1s linear; }

        .success-pop { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 3rem; font-weight: 900; text-shadow: 0 0 20px rgba(0,0,0,0.3); z-index: 100; animation: bouncePop 0.5s cubic-bezier(0.18, 0.89, 0.32, 1.28); color: #4ECDC4; }
        @keyframes bouncePop { 0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
        
        .placeholder { text-align: center; color: var(--text-secondary); margin-top: 3rem; }
        
        .primary-btn { background: var(--foreground); color: white; border: none; padding: 16px 40px; border-radius: 40px; font-size: 1.2rem; font-weight: 700; cursor: pointer; box-shadow: 0 10px 20px rgba(0,0,0,0.1); transition: transform 0.2s; }
        .primary-btn:hover { transform: scale(1.05); }

        .fadeIn { animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

        .mute-btn-mini { position: absolute; top: 1rem; right: 1rem; background: rgba(255,255,255,0.8); border: 1px solid var(--border); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1.1rem; box-shadow: var(--shadow-sm); z-index: 10; transition: all 0.2s; }
        .mute-btn-mini:hover { transform: scale(1.1); }
        .mute-btn-mini.muted { opacity: 0.5; }

        .confetti-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 50; overflow: hidden; }
        :global(.confetti-item) { position: absolute; width: 12px; height: 12px; top: -20px; animation: fall 2s ease-in forwards; }
        @keyframes fall { 0% { transform: translateY(0) rotate(0); opacity: 1; } 100% { transform: translateY(600px) rotate(720deg); opacity: 0; } }
        
        /* 반응형: 작은 화면에서 세로로 나오도록 구성 */
        @media (max-width: 900px) {
            .webcam-section { flex: 1 1 100%; }
            .game-panel { flex: 1 1 100%; min-height: auto;}
        }
      `}</style>
    </div>
  );
}
