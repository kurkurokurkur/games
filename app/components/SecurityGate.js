'use client';

import { useEffect, useRef, useState } from 'react';

const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_PATH  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
const LEFT_EYE  = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33];
const RIGHT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398,362];
const LEFT_EYEBROW  = [70,63,105,66,107,55,65,52,53,46];
const RIGHT_EYEBROW = [300,293,334,296,336,285,295,282,283,276];
const NOSE_BRIDGE   = [168,6,197,195,5];
const LIPS_OUTER    = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,61];
const LIPS_INNER    = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95,78];

const KEYPOINTS = [33,133,362,263,1,4,61,291,0,17,152,377,148,234,454];

function drawPolyline(ctx, lm, indices, w, h, close = false) {
  if (!lm || indices.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(lm[indices[0]].x * w, lm[indices[0]].y * h);
  for (let i = 1; i < indices.length; i++) ctx.lineTo(lm[indices[i]].x * w, lm[indices[i]].y * h);
  if (close) ctx.closePath();
  ctx.stroke();
}

export default function SecurityGate({ onUnlock }) {
  const videoRef         = useRef(null);
  const canvasRef        = useRef(null);
  const detectorRef      = useRef(null);
  const rafRef           = useRef();
  const latestResultRef  = useRef(null);
  
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const viewportRef  = useRef(null);

  const [isLoaded, setIsLoaded]         = useState(false);
  const [error, setError]               = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);

  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [showNameModal, setShowNameModal]     = useState(false);
  const [nameInput, setNameInput]             = useState('');
  
  const [countdown, setCountdown]             = useState(null); 
  const [verifyCountdown, setVerifyCountdown] = useState(null);
  
  const [gateStatus, setGateStatus]           = useState('idle'); // idle | scanning | granted | denied
  const [similarity, setSimilarity]           = useState(0);
  const [resultMsg, setResultMsg]             = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('securityGateUsers');
    if (stored) setRegisteredUsers(JSON.parse(stored));
    initDetector();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('securityGateUsers', JSON.stringify(registeredUsers));
  }, [registeredUsers]);

  const initDetector = async () => {
    try {
      const vision = await import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs");
      const { FaceLandmarker, FilesetResolver } = vision;
      const visionTasks = await FilesetResolver.forVisionTasks(WASM_PATH);
      detectorRef.current = await FaceLandmarker.createFromOptions(visionTasks, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
      });
      startCamera();
    } catch (err) {
      setError("Face model loading failed: " + err.message);
    }
  };

  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = async () => {
        try { await videoRef.current.play(); } catch (e) { if (e.name !== 'AbortError') throw e; }
        setIsLoaded(true);
        rafRef.current = requestAnimationFrame(predictLoop);
      };
    } catch (err) {
      setError("Camera access denied");
    }
  };

  const predictLoop = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!detectorRef.current || !video || video.readyState < 2 || !video.videoWidth) {
      rafRef.current = requestAnimationFrame(predictLoop);
      return;
    }
    try {
      const result = detectorRef.current.detectForVideo(video, performance.now());
      latestResultRef.current = result;
      drawLandmarks(result, canvas, video);
      updateAutoFraming(result);
      setFaceDetected(result.faceLandmarks && result.faceLandmarks.length > 0);
    } catch (e) {}
    rafRef.current = requestAnimationFrame(predictLoop);
  };

  const updateAutoFraming = (result) => {
    if (!viewportRef.current) return;
    let tx = 0, ty = 0, ts = 1;
    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      const landmarks = result.faceLandmarks[0];
      let minX = 1, maxX = 0, minY = 1, maxY = 0;
      landmarks.forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      });
      ts = Math.min(2.5, Math.max(1, 0.45 / (maxY - minY)));
      tx = ((minX + maxX) / 2 - 0.5) * 100 * ts;
      ty = ((minY + maxY) / 2 - 0.5) * 100 * ts;
    }
    const cur = transformRef.current;
    cur.x += (tx - cur.x) * 0.08; cur.y += (ty - cur.y) * 0.08; cur.scale += (ts - cur.scale) * 0.08;
    viewportRef.current.style.transform = `scale(${cur.scale}) translate(${cur.x}%, ${cur.y}%)`;
  };

  const drawLandmarks = (result, canvas, video) => {
    if (!canvas || !video) return;
    const w = video.videoWidth, h = video.videoHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) return;
    const lm = result.faceLandmarks[0];
    ctx.fillStyle = 'rgba(78, 205, 196, 0.5)';
    for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 1, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(78, 205, 196, 0.8)'; ctx.lineWidth = 1;
    drawPolyline(ctx, lm, FACE_OVAL, w, h, true);
    drawPolyline(ctx, lm, LEFT_EYE, w, h, true); drawPolyline(ctx, lm, RIGHT_EYE, w, h, true);
    drawPolyline(ctx, lm, LIPS_OUTER, w, h, true);
  };

  // 등록 로직
  const handleRegisterClick = () => {
    if (registeredUsers.length >= 5) { alert('최대 5명까지 등록할 수 있습니다.'); return; }
    setShowNameModal(true);
  };

  const startCountdown = () => {
    setShowNameModal(false);
    setCountdown(3);
  };

  const deleteUser = (index) => {
    setRegisteredUsers(prev => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { captureAndRegister(); setCountdown(null); return; }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const captureAndRegister = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = 60; canvas.height = 45;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 60, 45);
    const thumbnail = canvas.toDataURL();

    // predictLoop에서 저장된 최신 결과 사용 (동시 호출 방지)
    const result = latestResultRef.current;
    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) { 
      alert('얼굴을 인식하지 못했습니다. 화면에 얼굴이 잘 보이게 해주세요.'); 
      return; 
    }
    const lm = result.faceLandmarks[0], nb = lm[1];
    const vector = KEYPOINTS.map(idx => ({ x: lm[idx].x - nb.x, y: lm[idx].y - nb.y }));

    setRegisteredUsers(prev => [...prev, { name: nameInput.trim() || 'Unnamed', thumbnail, vector }]);
    setNameInput('');
  };

  // 검증 로직
  const handleVerifyClick = () => {
    if (verifyCountdown !== null) return;
    setGateStatus('scanning');
    setVerifyCountdown(3);
  };

  useEffect(() => {
    if (verifyCountdown === null) return;
    if (verifyCountdown === 0) { performVerification(); setVerifyCountdown(null); return; }
    const timer = setTimeout(() => setVerifyCountdown(verifyCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [verifyCountdown]);

  const performVerification = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    
    // predictLoop에서 저장된 최신 결과 사용 (동시 호출 방지)
    const result = latestResultRef.current;
    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
      setGateStatus('denied'); setResultMsg('🚫 얼굴을 찾을 수 없습니다.'); setSimilarity(0);
      setTimeout(() => setGateStatus('idle'), 3000);
      return;
    }

    const lm = result.faceLandmarks[0], nb = lm[1];
    const curVec = KEYPOINTS.map(idx => ({ x: lm[idx].x - nb.x, y: lm[idx].y - nb.y }));

    let bestMatch = { similarity: 0, name: '' };
    for (const user of registeredUsers) {
      let dist = 0;
      for (let i = 0; i < KEYPOINTS.length; i++) {
        const dx = curVec[i].x - user.vector[i].x, dy = curVec[i].y - user.vector[i].y;
        dist += Math.sqrt(dx * dx + dy * dy);
      }
      const score = Math.max(0, Math.round(100 - (dist / KEYPOINTS.length) * 1200)); 
      if (score > bestMatch.similarity) bestMatch = { similarity: score, name: user.name };
    }

    setSimilarity(bestMatch.similarity);
    if (bestMatch.similarity >= 70) {
      setGateStatus('granted'); setResultMsg(`✅ 입장 허가! ${bestMatch.name}님 환영합니다!`);
      if (onUnlock) onUnlock(bestMatch.name);
    } else {
      setGateStatus('denied'); setResultMsg('🚫 입장 거부! 등록되지 않은 얼굴입니다.');
      setTimeout(() => setGateStatus('idle'), 3000);
    }
  };

  return (
    <div className="detector-panel">
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2>🔐 VIP 라운지 — 보안 게이트</h2>
      </div>

      {!error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          {/* 상태 요약 */}
          <div className={`status-banner ${gateStatus}`}>
            <span className="status-label">현재 상태:</span>
            <span className="status-value">
              {gateStatus === 'idle' ? '🔘 대기 중' : 
               gateStatus === 'scanning' ? '🔍 스캔 중...' : 
               gateStatus === 'granted' ? '🔓 입장 허가!' : '🚫 입장 거부!'}
            </span>
            {similarity > 0 && <span className="sim-value">유사도: {similarity}%</span>}
          </div>

          <div className={`video-card ${gateStatus}`}>
            {!isLoaded && (
              <div className="loader">
                <div className="spinner-icon"></div>
                <p>로딩 중...</p>
              </div>
            )}
            
            <div className="video-wrapper mirrored">
              <div ref={viewportRef} className="viewport">
                <video ref={videoRef} playsInline muted className="main-video" />
                <canvas ref={canvasRef} className="main-canvas" />
                
                {/* 게이트 애니메이션 레이어 */}
                {gateStatus === 'granted' && (
                  <div className="gate-overlay">
                    <div className="door left"></div>
                    <div className="door right"></div>
                  </div>
                )}
              </div>
            </div>

            {/* 결과 메시지 */}
            {resultMsg && <div className={`result-overlay ${gateStatus}`}>{resultMsg}</div>}
          </div>

          <div className="action-row">
            <button 
              className="action-btn register" 
              onClick={handleRegisterClick} 
              disabled={!isLoaded || gateStatus !== 'idle'}
            >
              📸 얼굴 등록
            </button>
            <button 
              className="action-btn verify" 
              onClick={handleVerifyClick} 
              disabled={!isLoaded || registeredUsers.length === 0 || gateStatus !== 'idle'}
            >
              🔓 입장 시도
            </button>
          </div>

          {/* 목록 */}
          {registeredUsers.length > 0 && (
            <div className="user-list-card">
              <h3>👥 등록된 VIP ({registeredUsers.length}/5)</h3>
              <div className="user-grid">
                {registeredUsers.map((u, i) => (
                  <div key={i} className="user-item">
                    <img src={u.thumbnail} alt={u.name} />
                    <span>{u.name}</span>
                    <button className="del-btn" onClick={() => deleteUser(i)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 모달들 */}
      {showNameModal && (
        <div className="modal-overlay">
          <div className="modal-content fadeIn">
            <h3>VIP 이름 등록</h3>
            <input 
              type="text" value={nameInput} autoFocus
              onChange={e => setNameInput(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && startCountdown()}
              placeholder="이름을 입력하세요" 
            />
            <div className="modal-btns">
              <button className="cancel" onClick={() => setShowNameModal(false)}>취소</button>
              <button className="confirm" onClick={startCountdown}>시작</button>
            </div>
          </div>
        </div>
      )}

      {/* 카운트다운 */}
      {(countdown !== null || verifyCountdown !== null) && (
        <div className="cnt-overlay">
          <span className="cnt-val">{countdown || verifyCountdown}</span>
        </div>
      )}

      <style jsx>{`
        .detector-panel { width: 100%; max-width: 800px; margin: 0 auto; }
        
        .status-banner { width: 100%; max-width: 640px; padding: 1rem 1.5rem; border-radius: var(--radius-md); background: var(--glass-bg); backdrop-filter: blur(12px); display: flex; align-items: center; gap: 1rem; font-weight: 600; border: 1px solid var(--border); transition: all 0.3s; }
        .status-banner.scanning { border-color: rgba(59, 130, 246, 0.5); color: var(--accent-light); background: rgba(59, 130, 246, 0.08); }
        .status-banner.granted { border-color: rgba(34, 197, 94, 0.5); color: #4ade80; background: rgba(34, 197, 94, 0.08); }
        .status-banner.denied { border-color: rgba(239, 68, 68, 0.5); color: #f87171; background: rgba(239, 68, 68, 0.08); }
        .status-label { font-size: 0.85rem; color: var(--text-secondary); }
        .sim-value { margin-left: auto; color: #fbbf24; font-weight: 700; }

        .video-card { width: 100%; max-width: 640px; border-radius: var(--radius-lg); overflow: hidden; position: relative; border: 2px solid var(--border); transition: all 0.3s; background: #000; box-shadow: var(--shadow-md); }
        .video-card.scanning { border-color: var(--accent); box-shadow: 0 0 30px var(--accent-glow); }
        .video-card.granted { border-color: #22c55e; animation: gateBlink 0.5s infinite alternate; }
        .video-card.denied { border-color: #ef4444; animation: shake 0.4s; }
        @keyframes gateBlink { from { box-shadow: 0 0 10px rgba(34,197,94,0.3); } to { box-shadow: 0 0 40px rgba(34,197,94,0.5); } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }

        .loader { padding: 4rem; display: flex; flex-direction: column; align-items: center; gap: 1rem; }
        .spinner-icon { width: 40px; height: 40px; border: 3px solid rgba(59,130,246,0.2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .video-wrapper { position: relative; width: 100%; height: 360px; overflow: hidden; }
        .viewport { width: 100%; height: 100%; transition: transform 0.05s ease-out; }
        .main-video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .main-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        .mirrored { transform: scaleX(-1); }

        .result-overlay { position: absolute; bottom: 20px; left: 20px; right: 20px; padding: 1rem; border-radius: var(--radius-md); font-weight: 700; text-align: center; z-index: 50; animation: fadeInUp 0.4s; backdrop-filter: blur(8px); }
        .result-overlay.granted { background: rgba(34, 197, 94, 0.85); color: white; }
        .result-overlay.denied { background: rgba(239, 68, 68, 0.85); color: white; }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        .gate-overlay { position: absolute; inset: 0; display: flex; z-index: 100; pointer-events: none; }
        .door { flex: 1; background: var(--bg-deep); }
        .door.left { animation: openLeft 1s 0.2s forwards; }
        .door.right { animation: openRight 1s 0.2s forwards; }
        @keyframes openLeft { to { transform: translateX(-100%); opacity: 0; } }
        @keyframes openRight { to { transform: translateX(100%); opacity: 0; } }

        .action-row { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; }
        .action-btn { padding: 0.75rem 2rem; border-radius: 50px; border: none; font-weight: 700; cursor: pointer; transition: all 0.25s; font-family: inherit; font-size: 0.9rem; }
        .action-btn:disabled { background: rgba(255,255,255,0.06); color: var(--text-muted); cursor: not-allowed; box-shadow: none; border: 1px solid var(--border); }
        .action-btn.register { background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--border); }
        .action-btn.register:hover:not(:disabled) { border-color: var(--border-hover); background: rgba(59,130,246,0.1); }
        .action-btn.verify { background: var(--accent-gradient); color: white; box-shadow: 0 4px 20px var(--accent-glow); }
        .action-btn:hover:not(:disabled) { transform: translateY(-2px); }

        .user-list-card { width: 100%; max-width: 640px; padding: 1.5rem; background: var(--glass-bg); backdrop-filter: blur(12px); border-radius: var(--radius-lg); border: 1px solid var(--border); }
        .user-list-card h3 { color: var(--text-primary); font-size: 1rem; }
        .user-grid { display: flex; flex-wrap: wrap; gap: 1.2rem; margin-top: 1rem; justify-content: center; }
        .user-item { position: relative; width: 90px; text-align: center; display: flex; flex-direction: column; align-items: center; }
        .user-item img { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border); }
        .user-item span { font-size: 0.8rem; margin-top: 0.4rem; font-weight: 600; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
        .del-btn { position: absolute; top: -2px; right: 6px; width: 20px; height: 20px; border-radius: 50%; background: var(--bg-surface); color: #f87171; border: 1px solid rgba(239,68,68,0.3); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(7,11,20,0.9); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(8px); }
        .modal-content { background: var(--bg-surface); padding: 2.5rem; border-radius: var(--radius-xl); width: 340px; text-align: center; border: 1px solid var(--border); box-shadow: var(--shadow-lg); }
        .modal-content h3 { color: var(--text-primary); margin-bottom: 1.5rem; }
        .modal-content input { width: 100%; padding: 0.9rem 1rem; margin-bottom: 1.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 1rem; background: var(--bg-deep); color: var(--text-primary); outline: none; font-family: inherit; }
        .modal-content input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
        .modal-btns { display: flex; gap: 0.8rem; }
        .modal-btns button { flex: 1; padding: 0.75rem; border-radius: var(--radius-sm); border: none; font-weight: 700; cursor: pointer; font-family: inherit; }
        .modal-btns button.cancel { background: rgba(255,255,255,0.06); color: var(--text-secondary); border: 1px solid var(--border); }
        .modal-btns button.confirm { background: var(--accent-gradient); color: white; }

        .cnt-overlay { position: fixed; inset: 0; background: rgba(7,11,20,0.92); display: flex; align-items: center; justify-content: center; z-index: 2000; }
        .cnt-val { font-size: 10rem; font-weight: 900; color: var(--accent-light); text-shadow: 0 0 60px var(--accent-glow); animation: cntBounce 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        @keyframes cntBounce { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        
        .fadeIn { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}
