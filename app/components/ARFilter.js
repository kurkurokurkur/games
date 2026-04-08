'use client';

import { useEffect, useRef, useState } from 'react';

const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_PATH  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const POSITION_MAP = {
  headTop:    (lm) => ({ x: lm[10].x, y: lm[10].y }),
  leftEar:    (lm) => ({ x: lm[103].x, y: lm[103].y }),
  rightEar:   (lm) => ({ x: lm[332].x, y: lm[332].y }),
  forehead:   (lm) => ({ x: (lm[10].x + lm[151].x) / 2, y: lm[10].y }),
  eyes:       (lm) => ({ x: lm[168].x, y: lm[168].y }),
  nose:       (lm) => ({ x: lm[4].x, y: lm[4].y }),
  mouth:      (lm) => ({ x: (lm[61].x + lm[291].x) / 2, y: (lm[13].y + lm[14].y) / 2 }),
};

const BUILT_IN_FILTERS = [
  {
    id: 'dog',
    name: '🐶 강아지',
    items: [
      { emoji: '🐶', position: 'leftEar' },
      { emoji: '🐶', position: 'rightEar' }
    ]
  },
  {
    id: 'sunglasses',
    name: '😎 선글라스',
    items: [
      { emoji: '😎', position: 'eyes' }
    ]
  },
  {
    id: 'crown',
    name: '👑 왕관',
    items: [
      { emoji: 'headTop', position: 'headTop' }
    ]
  }
];

function getFaceAngle(lm) {
  const dx = lm[263].x - lm[33].x;
  const dy = lm[263].y - lm[33].y;
  return Math.atan2(dy, dx);
}

function getEyeDistance(lm, w) {
  return Math.sqrt(((lm[263].x - lm[33].x) * w) ** 2 + ((lm[263].y - lm[33].y) * w) ** 2);
}

function renderFilters(ctx, lm, w, h, activeFilter, activeCustoms, customFilters, customImages) {
  const eyeDist = getEyeDistance(lm, w);
  const angle = getFaceAngle(lm);

  if (activeFilter) {
    for (const item of activeFilter.items) {
      const pos = POSITION_MAP[item.position](lm);
      let size = eyeDist * 1.2;
      let offsetY = 0;

      if (activeFilter.id === 'dog') {
        size = eyeDist * 1.0;
        offsetY = -eyeDist * 0.3; 
      } else if (activeFilter.id === 'crown') {
        size = eyeDist * 1.8;
        offsetY = -eyeDist * 0.7; 
      } else if (activeFilter.id === 'sunglasses') {
        size = eyeDist * 2.2;
      }

      ctx.save();
      ctx.translate(pos.x * w, pos.y * h);
      ctx.rotate(angle);
      ctx.scale(-1, 1);
      
      const emojiToDraw = (activeFilter.id === 'crown') ? '👑' : item.emoji;
      ctx.font = `${size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emojiToDraw, 0, offsetY);
      ctx.restore();
    }
  }

  for (const cId of activeCustoms) {
    const cf = customFilters.find(f => f.id === cId);
    if (!cf) continue;
    const img = customImages[cId];
    if (!img || !img.complete) continue;
    const pos = POSITION_MAP[cf.position](lm);
    const sizeMultiplier = cf.position === 'headTop' || cf.position === 'forehead' ? 2.0 : 1.5;
    const drawW = eyeDist * sizeMultiplier;
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.translate(pos.x * w, pos.y * h);
    ctx.rotate(angle);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }
}

export default function ARFilter({ isUnlocked, vipName }) {
  const videoRef         = useRef(null);
  const canvasRef        = useRef(null);
  const detectorRef      = useRef(null);
  const rafRef           = useRef();
  const customImagesRef  = useRef({});
  const latestResultRef  = useRef(null);
  const fileInputRef     = useRef(null);

  const [isLoaded, setIsLoaded]           = useState(false);
  const [error, setError]                 = useState(null);
  const [activeFilter, setActiveFilter]   = useState(null);
  const [customFilters, setCustomFilters] = useState([]);
  const [activeCustoms, setActiveCustoms] = useState([]);
  const [modalOpen, setModalOpen]         = useState(false);
  const [pendingImage, setPendingImage]   = useState(null);
  
  const [photos, setPhotos]               = useState([]);
  const [countdown, setCountdown]         = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [showWelcome, setShowWelcome]     = useState(false);

  const activeFilterRef  = useRef(activeFilter);
  const activeCustomsRef = useRef(activeCustoms);
  const customFiltersRef = useRef(customFilters);

  useEffect(() => { activeFilterRef.current = activeFilter; }, [activeFilter]);
  useEffect(() => { activeCustomsRef.current = activeCustoms; }, [activeCustoms]);
  useEffect(() => { customFiltersRef.current = customFilters; }, [customFilters]);

  useEffect(() => {
    if (isUnlocked) {
      setShowWelcome(true);
      const timer = setTimeout(() => setShowWelcome(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isUnlocked]);

  useEffect(() => {
    const savedPhotos = localStorage.getItem('ar-photos');
    if (savedPhotos) setPhotos(JSON.parse(savedPhotos));
    initDetector();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('ar-photos', JSON.stringify(photos));
  }, [photos]);

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

      if (!canvas) { rafRef.current = requestAnimationFrame(predictLoop); return; }
      const w = video.videoWidth, h = video.videoHeight;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);

      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        renderFilters(ctx, result.faceLandmarks[0], w, h,
          activeFilterRef.current, activeCustomsRef.current,
          customFiltersRef.current, customImagesRef.current);
      }
    } catch (e) {}
    rafRef.current = requestAnimationFrame(predictLoop);
  };

  const playShutterSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  };

  const startPhotoSession = () => {
    if (countdown !== null) return;
    setCountdown(3);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      capturePhoto();
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const capturePhoto = () => {
    const video = videoRef.current;
    const result = latestResultRef.current;
    if (!video || !video.videoWidth) return;

    playShutterSound();

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    // 거울 모드로 촬영 (사용자가 보는 화면과 동일하게)
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    if (result && result.faceLandmarks && result.faceLandmarks.length > 0) {
      renderFilters(ctx, result.faceLandmarks[0], canvas.width, canvas.height,
        activeFilterRef.current, activeCustomsRef.current,
        customFiltersRef.current, customImagesRef.current);
    }

    const dataUrl = canvas.toDataURL('image/png');
    setPhotos(prev => [dataUrl, ...prev].slice(0, 10));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (customFilters.length >= 5) {
      alert("커스텀 필터는 최대 5개까지 추가할 수 있습니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setPendingImage(event.target.result);
      setModalOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = null;
  };

  const addCustomFilter = (position) => {
    const id = 'custom-' + Date.now();
    const img = new Image();
    img.src = pendingImage;
    customImagesRef.current[id] = img;
    
    const newFilter = { id, name: '커스텀', position, src: pendingImage };
    setCustomFilters(prev => [...prev, newFilter]);
    setActiveCustoms(prev => [...prev, id]);
    setModalOpen(false);
    setPendingImage(null);
  };

  const removeCustomFilter = (id) => {
    setCustomFilters(prev => prev.filter(f => f.id !== id));
    setActiveCustoms(prev => prev.filter(cid => cid !== id));
    delete customImagesRef.current[id];
  };

  return (
    <div className="detector-panel">
      {showWelcome && (
        <div className="welcome-overlay-container">
          <div className="welcome-badge slideDown">
            <span className="badge-icon">👑</span>
            <div className="badge-text">
              <strong>VIP 입장!</strong>
              <span>{vipName}님, 환영합니다.</span>
            </div>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2>🎭 AR 필터</h2>
      </div>

      {error && <div style={{ padding: '3rem', textAlign: 'center', color: '#ff6b6b' }}>{error}</div>}

      {!error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          {/* 비디오 화면 */}
          <div className="card main-video-card">
            {!isLoaded && (
              <div className="loader-overlay">
                <div className="spinner-icon"></div>
                <p>🔄 모델 로딩 중...</p>
              </div>
            )}
            <div className="video-wrapper mirrored" style={{ display: isLoaded ? 'block' : 'none' }}>
              <video ref={videoRef} playsInline muted style={{ display: 'block', width: '100%', borderRadius: 'var(--radius-lg)' }} />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
              
              {countdown !== null && (
                <div className="countdown-overlay">
                  <div style={{ transform: 'scaleX(-1)' }}>
                    <span className="countdown-text">{countdown > 0 ? countdown : '📸!'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 촬영 버튼 */}
          <button 
            className="capture-btn" 
            onClick={startPhotoSession}
            disabled={!isLoaded || countdown !== null}
          >
            📸 사진 찍기
          </button>

          {/* 필터 선택 UI */}
          <div className="filter-controls-container card">
            <div className="filter-section">
              <p className="section-title">✨ 기본 필터</p>
              <div className="filter-grid">
                <button 
                  className={`filter-btn-chip ${!activeFilter ? 'active' : ''}`}
                  onClick={() => setActiveFilter(null)}
                >
                  ❌ 없음
                </button>
                {BUILT_IN_FILTERS.map(f => (
                  <button 
                    key={f.id}
                    className={`filter-btn-chip ${activeFilter?.id === f.id ? 'active' : ''}`}
                    onClick={() => setActiveFilter(f)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <p className="section-title">🖼️ 커스텀 필터</p>
                {customFilters.length < 5 && (
                  <button className="add-filter-link" onClick={() => fileInputRef.current.click()}>+ 새 필터 추가</button>
                )}
              </div>
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleFileChange} />
              
              <div className="custom-gallery">
                {customFilters.map(cf => (
                  <div key={cf.id} className="custom-item">
                    <div 
                      className={`custom-thumb ${activeCustoms.includes(cf.id) ? 'active' : ''}`}
                      onClick={() => setActiveCustoms(prev => prev.includes(cf.id) ? prev.filter(c => c !== cf.id) : [...prev, cf.id])}
                    >
                      <img src={cf.src} alt="custom" />
                    </div>
                    <button className="mini-del-btn" onClick={() => removeCustomFilter(cf.id)}>×</button>
                  </div>
                ))}
                {customFilters.length === 0 && <p className="empty-text">업로드된 필터가 없습니다.</p>}
              </div>
            </div>
          </div>

          {/* 사진 갤러리 */}
          {photos.length > 0 && (
            <div className="photo-gallery-container card">
              <p className="section-title">📂 촬영된 사진 ({photos.length}/10)</p>
              <div className="photo-list">
                {photos.map((url, i) => (
                  <div key={i} className="photo-item">
                    <img src={url} alt={`Photo ${i}`} onClick={() => setSelectedPhoto(url)} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 커스텀 필터 생성 모달 */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-content fadeIn">
            <h3>필터 위치 선택</h3>
            <p className="modal-desc">이미지가 얼굴 어디에 나타날까요?</p>
            <div className="pos-grid">
              <button onClick={() => addCustomFilter('headTop')}>이마/머리</button>
              <button onClick={() => addCustomFilter('eyes')}>눈/안경</button>
              <button onClick={() => addCustomFilter('nose')}>코/중앙</button>
              <button onClick={() => addCustomFilter('mouth')}>입/하단</button>
            </div>
            <button className="cancel-modal-btn" onClick={() => { setModalOpen(false); setPendingImage(null); }}>취소</button>
          </div>
        </div>
      )}

      {/* 사진 크게 보기 모달 */}
      {selectedPhoto && (
        <div className="modal-overlay" onClick={() => setSelectedPhoto(null)}>
          <div className="photo-view-modal fadeIn" onClick={e => e.stopPropagation()}>
            <img src={selectedPhoto} alt="Zoom" className="main-zoom-img" />
            <div className="photo-actions">
              <a 
                href={selectedPhoto} 
                download="ar-filter-photo.png" 
                className="action-btn download"
              >
                💾 저장하기
              </a>
              <button 
                className="action-btn delete"
                onClick={() => {
                  setPhotos(prev => prev.filter(p => p !== selectedPhoto));
                  setSelectedPhoto(null);
                }}
              >
                🗑️ 삭제하기
              </button>
              <button className="action-btn close" onClick={() => setSelectedPhoto(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .detector-panel { width: 100%; max-width: 800px; margin: 0 auto; color: var(--text-primary); position: relative; }
        .card { background: var(--glass-bg); backdrop-filter: blur(16px); border-radius: var(--radius-lg); padding: 1.5rem; border: 1px solid var(--border); box-shadow: var(--shadow-sm); width: 100%; max-width: 640px; }
        .main-video-card { padding: 0; overflow: hidden; position: relative; border: 2px solid var(--border); }
        
        .loader-overlay { padding: 4rem 2rem; background: var(--bg-surface); display: flex; flex-direction: column; align-items: center; }
        .spinner-icon { width: 40px; height: 40px; border: 3px solid rgba(59,130,246,0.15); border-top: 3px solid var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 1rem; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .video-wrapper { position: relative; background: #000; overflow: hidden; }
        .mirrored { transform: scaleX(-1); }

        .countdown-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(7,11,20,0.3); pointer-events: none; z-index: 10; }
        .countdown-text { font-size: 8rem; font-weight: 900; color: var(--accent-light); text-shadow: 0 0 40px var(--accent-glow); animation: bounceIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        @keyframes bounceIn { from { transform: scale(0.5) rotate(-10deg); opacity: 0; } to { transform: scale(1) rotate(0); opacity: 1; } }

        .capture-btn { 
          margin-top: 0.5rem;
          padding: 1rem 3rem; font-size: 1.15rem; font-weight: 700; 
          background: var(--accent-gradient); color: white; border: none; 
          border-radius: 50px; cursor: pointer; font-family: inherit;
          box-shadow: 0 8px 25px var(--accent-glow); transition: all 0.25s;
        }
        .capture-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 12px 35px var(--accent-glow); }
        .capture-btn:active:not(:disabled) { transform: translateY(0); }
        .capture-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .filter-controls-container { background: var(--glass-bg); backdrop-filter: blur(16px); }
        .filter-section { margin-bottom: 1.5rem; }
        .filter-section:last-child { margin-bottom: 0; }
        .section-title { font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.8rem; letter-spacing: 0.03em; }
        .filter-grid { display: flex; gap: 0.6rem; flex-wrap: wrap; }
        
        .filter-btn-chip {
          padding: 0.5rem 1rem; background: rgba(255,255,255,0.04);
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          font-weight: 600; cursor: pointer; transition: all 0.2s;
          color: var(--text-secondary); font-family: inherit; font-size: 0.85rem;
        }
        .filter-btn-chip:hover { border-color: var(--border-hover); color: var(--text-primary); background: rgba(59,130,246,0.08); }
        .filter-btn-chip.active { background: var(--accent-gradient); color: white; border-color: transparent; box-shadow: 0 4px 15px var(--accent-glow); }

        .add-filter-link { font-size: 0.8rem; color: var(--accent-light); font-weight: 600; background: none; border: none; cursor: pointer; font-family: inherit; }
        .custom-gallery { display: flex; gap: 0.8rem; overflow-x: auto; padding: 4px; min-height: 60px; scrollbar-width: none; }
        .custom-gallery::-webkit-scrollbar { display: none; }
        .custom-item { position: relative; flex-shrink: 0; }
        .custom-thumb { width: 56px; height: 56px; border-radius: var(--radius-sm); border: 2px solid var(--border); overflow: hidden; cursor: pointer; background: var(--bg-surface); transition: all 0.2s; }
        .custom-thumb.active { border-color: var(--accent); transform: scale(1.08); box-shadow: 0 0 15px var(--accent-glow); }
        .custom-thumb img { width: 100%; height: 100%; object-fit: contain; }
        .mini-del-btn { position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; background: var(--bg-surface); color: #f87171; border: 1px solid rgba(239,68,68,0.3); border-radius: 50%; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .empty-text { font-size: 0.85rem; color: var(--text-muted); font-style: italic; }

        .photo-gallery-container { background: var(--glass-bg); backdrop-filter: blur(16px); }
        .photo-list { display: flex; gap: 0.8rem; overflow-x: auto; padding-bottom: 0.5rem; }
        .photo-item { flex-shrink: 0; width: 110px; height: 68px; border-radius: var(--radius-sm); overflow: hidden; border: 2px solid var(--border); cursor: pointer; transition: all 0.2s; }
        .photo-item:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: 0 0 12px var(--accent-glow); }
        .photo-item img { width: 100%; height: 100%; object-fit: cover; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(7,11,20,0.9); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal-content { background: var(--bg-surface); padding: 2.5rem; border-radius: var(--radius-xl); width: 90%; max-width: 380px; text-align: center; border: 1px solid var(--border); box-shadow: var(--shadow-lg); }
        .modal-content h3 { color: var(--text-primary); margin-bottom: 0.5rem; }
        .modal-desc { color: var(--text-secondary); margin-bottom: 2rem; font-size: 0.9rem; }
        .pos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 2rem; }
        .pos-grid button { padding: 1rem 0.5rem; background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: var(--radius-md); font-weight: 600; cursor: pointer; transition: all 0.2s; color: var(--text-primary); font-family: inherit; }
        .pos-grid button:hover { background: rgba(59,130,246,0.1); border-color: var(--border-hover); }
        .cancel-modal-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; text-decoration: underline; font-family: inherit; }

        .photo-view-modal { background: var(--bg-surface); padding: 1.5rem; border-radius: var(--radius-xl); max-width: 90vw; width: 640px; display: flex; flex-direction: column; gap: 1.5rem; border: 1px solid var(--border); }
        .main-zoom-img { width: 100%; border-radius: var(--radius-lg); }
        .photo-actions { display: flex; gap: 0.8rem; justify-content: center; flex-wrap: wrap; }
        .action-btn { padding: 0.7rem 1.5rem; border-radius: var(--radius-sm); border: none; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; font-family: inherit; font-size: 0.85rem; transition: all 0.2s; }
        .action-btn.download { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
        .action-btn.delete { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
        .action-btn.close { background: rgba(255,255,255,0.06); color: var(--text-secondary); border: 1px solid var(--border); }
        .action-btn:hover { transform: translateY(-1px); }
        
        .welcome-overlay-container { position: absolute; top: 20px; left: 0; right: 0; z-index: 200; display: flex; justify-content: center; pointer-events: none; }
        .welcome-badge { 
          background: linear-gradient(135deg, rgba(59,130,246,0.9) 0%, rgba(139,92,246,0.9) 100%); 
          color: white; padding: 0.8rem 1.8rem; border-radius: 50px; 
          display: flex; align-items: center; gap: 0.8rem; 
          box-shadow: 0 8px 30px var(--accent-glow);
          border: 1px solid rgba(255,255,255,0.2);
          backdrop-filter: blur(8px);
        }
        .badge-icon { font-size: 1.3rem; }
        .badge-text { display: flex; flex-direction: column; text-align: left; }
        .badge-text strong { font-size: 1rem; }
        .badge-text span { font-size: 0.8rem; opacity: 0.85; }
        
        .slideDown { animation: slideDown 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        @keyframes slideDown { 
          from { transform: translateY(-100px); opacity: 0; } 
          to { transform: translateY(0); opacity: 1; } 
        }

        .fadeIn { animation: fadeIn 0.3s ease-out forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}
