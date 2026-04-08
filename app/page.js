'use client';

import { useState } from 'react';
import RPSGame from './components/RPSGame';
import ObjectDetection from './components/ObjectDetection';
import HandPose from './components/HandPose';
import SecurityGate from './components/SecurityGate';
import ARFilter from './components/ARFilter';

export default function Home() {
  const [activeTab, setActiveTab] = useState('rps');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [vipName, setVipName] = useState('');

  const TABS = [
    { id: 'rps', icon: '🎮', label: '가위바위보 — 2주차' },
    { id: 'drag', icon: '📦', label: '물건 이동 — 3주차' },
    { id: 'pose', icon: '✋', label: '핸드포즈 — 3주차' },
    { id: 'security', icon: '🔐', label: '보안 게이트 — 4주차' },
    { id: 'filter', icon: isUnlocked ? '🎭' : '🔒', label: isUnlocked ? 'AR 필터 — 4주차' : '🔒 AR 필터 — 4주차' }
  ];

  const handleUnlock = (name) => {
    if (!isUnlocked) {
      setIsUnlocked(true);
      setVipName(name);
    }
  };

  const activeLabel = TABS.find((t) => t.id === activeTab)?.label;

  return (
    <main>
      {/* ─── Header Card ─── */}
      <div className="card" style={{ width: '100%', maxWidth: '900px' }}>
        <div className="header-badge">AI EXPERIENCE CENTER</div>
        <h1>🎮 AI 체험관</h1>
        <p className="subtitle">현준이의 · 나만의 AI 체험 세계</p>
        
        <div className="tabContainer">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tabButton ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span> 
              <span className="tab-text">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Content Area ─── */}
      <div key={activeTab} className="contentArea fadeIn">
        {activeTab === 'rps' ? (
          <RPSGame />
        ) : activeTab === 'drag' ? (
          <ObjectDetection />
        ) : activeTab === 'pose' ? (
          <HandPose />
        ) : activeTab === 'security' ? (
          <SecurityGate onUnlock={handleUnlock} />
        ) : activeTab === 'filter' ? (
          <div style={{ position: 'relative' }}>
            <ARFilter isUnlocked={isUnlocked} vipName={vipName} />
            
            {!isUnlocked && (
              <div className="lockOverlay fadeIn">
                <div className="lockContent">
                  <div className="lockPulse">
                    <span className="lockIcon">🔒</span>
                  </div>
                  <h3>VIP ACCESS REQUIRED</h3>
                  <p>이곳은 인증된 VIP 전용 구역입니다.<br/>보안 게이트에서 얼굴 인증을 완료해주세요.</p>
                  <button className="gateLinkBtn" onClick={() => setActiveTab('security')}>
                    <span className="btnGlow"></span>
                    🛡️ 보안 게이트로 이동
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="gamePlaceholder">
            <p>여기에 {activeLabel}이 들어갈 예정입니다.</p>
          </div>
        )}
      </div>

      {/* ─── Footer ─── */}
      <footer className="main-footer">
        <p>Made with ❤️ by 박현준 · 2024 AI LAB Professional</p>
      </footer>

      <style jsx>{`
        main {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem 4rem;
        }

        .header-badge {
          display: inline-block;
          padding: 0.4rem 1.2rem;
          background: var(--accent-gradient);
          color: white;
          border-radius: 50px;
          font-size: 0.75rem;
          font-weight: 800;
          letter-spacing: 0.2em;
          margin-bottom: 1.5rem;
          box-shadow: 0 4px 15px var(--accent-glow);
        }

        h1 {
          font-size: 3.5rem;
          margin-bottom: 0.5rem;
          background: linear-gradient(135deg, #ffffff 0%, #60a5fa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          filter: drop-shadow(0 0 15px rgba(59, 130, 246, 0.3));
        }

        .subtitle {
          font-size: 1.2rem;
          color: var(--text-secondary);
          letter-spacing: 0.1em;
          margin-bottom: 1rem;
        }

        .tabContainer {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 0.6rem;
          margin-top: 2rem;
          width: 100%;
        }

        .tabButton {
          padding: 0.8rem 1rem;
          border-radius: var(--radius-md);
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }

        .tabButton:hover {
          background: rgba(59, 130, 246, 0.1);
          border-color: var(--border-hover);
          color: var(--text-primary);
          transform: translateY(-3px);
        }

        .tabButton.active {
          background: var(--accent-gradient);
          color: white;
          border-color: transparent;
          box-shadow: 0 8px 20px var(--accent-glow);
          transform: translateY(-5px);
        }

        .tab-icon { font-size: 1.5rem; }
        .tab-text { font-size: 0.8rem; font-weight: 600; }

        .main-footer {
          margin-top: auto;
          padding-top: 4rem;
          color: var(--text-muted);
          font-size: 0.9rem;
          letter-spacing: 0.05em;
        }

        .lockOverlay {
          position: absolute;
          inset: -20px;
          background: rgba(7, 11, 20, 0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-lg);
        }

        .lockContent {
          text-align: center;
          background: var(--glass-bg);
          backdrop-filter: blur(30px);
          padding: 3.5rem;
          border-radius: 32px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.6);
          border: 1px solid var(--border);
          max-width: 440px;
        }

        .lockPulse {
          width: 90px; height: 90px;
          margin: 0 auto 2rem;
          display: flex; align-items: center; justify-content: center;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.15);
          border: 2px solid var(--border);
          animation: lockPulse 2.5s ease-in-out infinite;
        }

        @keyframes lockPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.3); transform: scale(1); }
          50% { box-shadow: 0 0 0 20px rgba(59, 130, 246, 0); transform: scale(1.05); }
        }

        .lockIcon { font-size: 2.5rem; }

        .lockContent h3 { 
          font-size: 1.4rem; 
          margin-bottom: 1rem; 
          letter-spacing: 0.1em;
          color: var(--accent-light);
        }

        .lockContent p { 
          color: var(--text-secondary); 
          margin-bottom: 2.5rem; 
          line-height: 1.8;
          font-size: 1rem;
        }

        .gateLinkBtn {
          position: relative;
          padding: 1rem 2.5rem;
          background: var(--accent-gradient);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 700;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.3s;
          overflow: hidden;
          font-family: inherit;
        }

        .gateLinkBtn:hover { 
          transform: translateY(-3px); 
          box-shadow: 0 12px 30px var(--accent-glow);
        }

        .btnGlow {
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
          animation: btnShimmer 2s infinite;
        }

        @keyframes btnShimmer {
          from { transform: translateX(-100%); }
          to { transform: translateX(100%); }
        }
      `}</style>
    </main>
  );
}
