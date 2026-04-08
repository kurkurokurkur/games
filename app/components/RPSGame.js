'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Script from 'next/script';

const TM_URL = "https://teachablemachine.withgoogle.com/models/6CfPXwqAC/";
const EMOJI_MAP = { "가위": "✌️", "바위": "✊", "보": "🖐️", "준비": "❓" };

export default function RPSGame() {
    // Game State
    const [scriptsLoaded, setScriptsLoaded] = useState({ tf: false, tm: false });
    const [isModelReady, setIsModelReady] = useState(false);
    const [playerScore, setPlayerScore] = useState(0);
    const [cpuScore, setCpuScore] = useState(0);
    const [gameResult, setGameResult] = useState("도전 준비!");
    const [resultType, setResultType] = useState(""); // "win", "lose", "draw", ""
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [userName, setUserName] = useState("플레이어");
    const [isEditingName, setIsEditingName] = useState(false);
    const [gameSpeed, setGameSpeed] = useState(1000); // 1000: Normal, 500: Speed
    const [isSeriesMode, setIsSeriesMode] = useState(false);
    const [gameHistory, setGameHistory] = useState([]);
    const [countdown, setCountdown] = useState(null);
    const [predictions, setPredictions] = useState([]);
    const [playerEmoji, setPlayerEmoji] = useState("❓");
    const [cpuEmoji, setCpuEmoji] = useState("❓");
    const [stats, setStats] = useState({ total: 0, wins: 0, moves: { "가위": 0, "바위": 0, "보": 0 } });
    const [isShaking, setIsShaking] = useState(false);

    // Refs
    const modelRef = useRef(null);
    const webcamRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const audioCtxRef = useRef(null);
    const masterGainRef = useRef(null);
    const currentPredictionRef = useRef("");
    const currentProbabilityRef = useRef(0);
    const loopRef = useRef(null);

    // 1. Audio Logic
    const initAudio = () => {
        if (audioCtxRef.current) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtxRef.current = new AudioContext();
        masterGainRef.current = audioCtxRef.current.createGain();
        masterGainRef.current.gain.value = 0.3;
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
        gain.gain.linearRampToValueAtTime(0.5, audioCtxRef.current.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtxRef.current.currentTime + duration);
        osc.connect(gain);
        gain.connect(masterGainRef.current);
        osc.start();
        osc.stop(audioCtxRef.current.currentTime + duration);
    };

    const playSequence = async (notes) => {
        for (const note of notes) {
            playTone(note.freq, note.duration);
            await new Promise(res => setTimeout(res, note.duration * 1000));
        }
    };

    // 2. Teachable Machine Logic
    const predict = useCallback(async () => {
        if (!modelRef.current || !webcamRef.current) return;
        webcamRef.current.update();
        const prediction = await modelRef.current.predict(webcamRef.current.canvas);
        
        let maxProb = 0;
        let pArray = [];
        for (let i = 0; i < modelRef.current.getTotalClasses(); i++) {
            const prob = prediction[i].probability;
            pArray.push({ label: prediction[i].className, probability: prob });
            if (prob > maxProb) {
                maxProb = prob;
                currentPredictionRef.current = prediction[i].className;
                currentProbabilityRef.current = prob;
            }
        }
        setPredictions(pArray);
    }, []);

    const loop = useCallback(async () => {
        await predict();
        loopRef.current = requestAnimationFrame(loop);
    }, [predict]);

    const initModelAndWebcam = async () => {
        if (isModelReady || isPlaying) return;
        initAudio();
        setGameResult("마이크/카메라 권한 요청 중...");
        
        try {
            // Step 1: Pre-check camera access using raw browser API
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                stream.getTracks().forEach(track => track.stop()); // Stop immediately, just checking
            } catch (mediaErr) {
                console.error("Native Media API Error:", mediaErr);
                if (mediaErr.name === 'NotAllowedError') {
                    throw new Error("카메라 권한이 거부되었습니다. 주소창 설정을 확인해 주세요.");
                } else if (mediaErr.name === 'NotFoundError') {
                    throw new Error("카메라를 찾을 수 없습니다.");
                } else if (mediaErr.name === 'NotReadableError') {
                    throw new Error("카메라가 다른 프로그램(Zoom, OBS 등)에서 사용 중입니다.");
                } else {
                    throw new Error(`카메라 접근 중 오류가 발생했습니다: ${mediaErr.message}`);
                }
            }

            const modelURL = TM_URL + "model.json";
            const metadataURL = TM_URL + "metadata.json";
            
            if (!modelRef.current) {
                modelRef.current = await window.tmImage.load(modelURL, metadataURL);
            }
            
            if (!webcamRef.current) {
                const flip = true;
                // Try a more flexible setup if default fails
                webcamRef.current = new window.tmImage.Webcam(400, 300, flip);
                try {
                    await webcamRef.current.setup();
                } catch (tmErr) {
                    // Fallback to minimal constraints if 400x300 fails
                    await webcamRef.current.setup({ width: 640, height: 480 });
                }
                await webcamRef.current.play();
            }
            
            const webcam = webcamRef.current;
            if (canvasContainerRef.current && canvasContainerRef.current.childNodes.length === 0) {
                // Ensure canvas exists and is a DOM node
                const canvas = webcam.canvas;
                if (canvas instanceof HTMLCanvasElement) {
                    canvasContainerRef.current.appendChild(canvas);
                    canvas.style.borderRadius = "16px";
                    canvas.style.width = "100%";
                    canvas.style.height = "auto";
                } else {
                    console.error("Webcam canvas is not a valid DOM node:", canvas);
                    throw new Error("카메라 캔버스 생성 중 오류가 발생했습니다.");
                }
            }
            
            setIsModelReady(true);
            setGameResult("도전 준비!");
            loopRef.current = requestAnimationFrame(loop);
        } catch (err) {
            console.error("Camera Diagnostic Error:", err);
            setGameResult(err.message || "카메라 연결 실패 ❌");
        }
    };

    useEffect(() => {
        return () => {
            if (loopRef.current) cancelAnimationFrame(loopRef.current);
            // In a tabbed environment, we keep the webcam instance for performance 
            // but we stop the loop.
        };
    }, []);

    // 3. Game Loop
    const startChallenge = async () => {
        if (isPlaying || !isModelReady) return;
        initAudio();
        playTone(600, 0.05);
        setIsPlaying(true);
        
        // Use local scores during the loop to avoid stale state in async while
        let currentPScore = playerScore;
        let currentCScore = cpuScore;

        while (true) {
            setPlayerEmoji("❓");
            setCpuEmoji("❓");
            setIsShaking(false);
            setResultType("");
            
            const counts = ["3", "2", "1", "찰칵! 📸"];
            for (let i = 0; i < 4; i++) {
                setCountdown(counts[i]);
                if (i < 3) playTone(800, 0.1); else playTone(1200, 0.05, "square");
                await new Promise(r => setTimeout(r, gameSpeed));
            }
            setCountdown(null);

            if (currentProbabilityRef.current < 0.6) {
                setGameResult("인식 실패! 다시 시도해주세요 ⚠️");
                setResultType("draw");
                await new Promise(r => setTimeout(r, 2000));
                if (!isSeriesMode) break;
                continue;
            }

            const playerChoice = currentPredictionRef.current;
            const choices = ["가위", "바위", "보"];
            const cpuChoice = choices[Math.floor(Math.random() * 3)];
            
            setPlayerEmoji(EMOJI_MAP[playerChoice]);
            setCpuEmoji(EMOJI_MAP[cpuChoice]);
            
            // Statistics & History
            setStats(prev => ({
                ...prev,
                total: prev.total + 1,
                moves: { ...prev.moves, [playerChoice]: prev.moves[playerChoice] + 1 }
            }));

            let result = "";
            if (playerChoice === cpuChoice) {
                result = "draw";
                setGameResult("무승부! 다시 한 번? ➖");
                setResultType("draw");
                playSequence([{freq: 440, duration: 0.1}, {freq: 440, duration: 0.1}]);
            } else if ((playerChoice === "바위" && cpuChoice === "가위") || (playerChoice === "보" && cpuChoice === "바위") || (playerChoice === "가위" && cpuChoice === "보")) {
                result = "win";
                currentPScore++;
                setPlayerScore(currentPScore);
                setStats(prev => ({ ...prev, wins: prev.wins + 1 }));
                setGameResult(`🎉 승리! ⭕`);
                setResultType("win");
                createConfetti();
                playSequence([{freq: 261, duration: 0.15}, {freq: 329, duration: 0.15}, {freq: 392, duration: 0.15}]);
            } else {
                result = "lose";
                currentCScore++;
                setCpuScore(currentCScore);
                setGameResult("컴퓨터의 승리... ❌");
                setResultType("lose");
                setIsShaking(true);
                playSequence([{freq: 392, duration: 0.15}, {freq: 329, duration: 0.15}, {freq: 261, duration: 0.15}]);
            }

            const historySymbol = { win: "⭕", lose: "❌", draw: "➖" }[result] || "❓";
            setGameHistory(prev => [historySymbol, ...prev].slice(0, 5));

            if (isSeriesMode) {
                if (currentPScore === 3 || currentCScore === 3) {
                    const finalWinner = currentPScore === 3 ? userName : "컴퓨터";
                    setGameResult(`🏆 최종 승자: ${finalWinner}!`);
                    await new Promise(r => setTimeout(r, 3000));
                    break;
                }
                await new Promise(r => setTimeout(r, 2000));
            } else {
                await new Promise(r => setTimeout(r, 2000));
                break;
            }
        }
        setIsPlaying(false);
    };

    const resetGame = () => {
        setPlayerScore(0);
        setCpuScore(0);
        setGameResult("도전 준비!");
        setResultType("");
        setPlayerEmoji("❓");
        setCpuEmoji("❓");
        setGameHistory([]);
        setStats({ total: 0, wins: 0, moves: { "가위": 0, "바위": 0, "보": 0 } });
        playTone(600, 0.05);
    };

    const createConfetti = () => {
        const container = document.getElementById("confetti-box");
        if (!container) return;
        const colors = ["#FFD700", "#7B61FF", "#00AFFF", "#FF6B6B"];
        for (let i = 0; i < 20; i++) {
            const confetti = document.createElement("div");
            confetti.className = "confetti-piece";
            confetti.style.left = Math.random() * 100 + "%";
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDelay = Math.random() * 2 + "s";
            container.appendChild(confetti);
            setTimeout(() => confetti.remove(), 3000);
        }
    };

    const winRate = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(0) : 0;
    const maxVal = Math.max(...Object.values(stats.moves));

    return (
        <div className={`rps-container ${isShaking ? 'shake-screen' : ''}`}>
            <Script 
                src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js"
                onLoad={() => setScriptsLoaded(prev => ({ ...prev, tf: true }))}
            />
            <Script 
                src="https://cdn.jsdelivr.net/npm/@teachablemachine/image@latest/dist/teachablemachine-image.min.js"
                onLoad={() => setScriptsLoaded(prev => ({ ...prev, tm: true }))}
            />

            <div className="rps-header">
                <div className="user-setup">
                    {isEditingName ? (
                        <div className="name-edit-box">
                            <input 
                                type="text" 
                                value={userName} 
                                onChange={(e) => setUserName(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && setIsEditingName(false)}
                                maxLength={10}
                                className="name-input"
                            />
                            <button onClick={() => setIsEditingName(false)} className="save-btn">확인</button>
                        </div>
                    ) : (
                        <div className="name-display-box">
                            <span>{userName}</span>
                            <button onClick={() => setIsEditingName(true)} className="edit-btn">✏️</button>
                        </div>
                    )}
                </div>
                <div className="mode-selector">
                    <button 
                        className={`mode-btn ${gameSpeed === 1000 ? 'active' : ''}`}
                        onClick={() => setGameSpeed(1000)}
                    >🍦 일반</button>
                    <button 
                        className={`mode-btn ${gameSpeed === 500 ? 'active' : ''}`}
                        onClick={() => setGameSpeed(500)}
                    >⚡ 스피드</button>
                    <button 
                        className={`mute-btn ${isMuted ? 'muted' : ''}`}
                        onClick={() => setIsMuted(!isMuted)}
                    >{isMuted ? '🔇' : '🔊'}</button>
                </div>
            </div>

            <div className="game-layout">
                {/* Webcam Section */}
                <div className="webcam-pane card">
                    {!isModelReady ? (
                        <div className="loader-box">
                            <div className="status-emoji">📷</div>
                            <p className="status-text">AI 가위바위보를 즐기려면<br/>카메라를 켜주세요!</p>
                            <button 
                                onClick={initModelAndWebcam} 
                                className="init-btn"
                                disabled={!scriptsLoaded.tf || !scriptsLoaded.tm}
                            >
                                {(!scriptsLoaded.tf || !scriptsLoaded.tm) ? "라이브러리 로딩 중..." : "카메라 켜기"}
                            </button>
                            <div className="permission-guide">
                                💡 주소창의 <b>자물쇠 아이콘</b>을 클릭해<br/>카메라 권한을 <b>'허용'</b>으로 바꿔주세요.
                            </div>
                        </div>
                    ) : (
                        <div className="webcam-ready-info">카메라 연결됨 ✅</div>
                    )}
                    <div ref={canvasContainerRef} className="webcam-view"></div>
                    <div className="prediction-labels">
                        {predictions.map((p, i) => (
                            <div key={p.label} className="prob-item">
                                <div className="prob-text">
                                    <span>{EMOJI_MAP[p.label]} {p.label}</span>
                                    <span>{(p.probability * 100).toFixed(0)}%</span>
                                </div>
                                <div className="prob-bar-bg">
                                    <div 
                                        className={`prob-bar-fill fill-${p.label} ${p.probability > 0.8 ? 'glow' : ''}`}
                                        style={{ width: `${(p.probability * 100).toFixed(0)}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Score Section */}
                <div className="score-pane card">
                    <div className="scoreboard">
                        <div className="score-item">
                            <span className="player-label">{userName}</span>
                            <span className="score-val">{playerScore}</span>
                        </div>
                        <div className="vs">VS</div>
                        <div className="score-item">
                            <span className="player-label">컴퓨터</span>
                            <span className="score-val">{cpuScore}</span>
                        </div>
                    </div>

                    <div className="match-visual">
                        <div className="match-emojis">
                            <span className={`emoji-box ${resultType === 'win' ? 'bounce' : ''}`}>{playerEmoji}</span>
                            <span className="match-thunder">⚡</span>
                            <span className={`emoji-box ${resultType === 'lose' ? 'bounce' : ''}`}>{cpuEmoji}</span>
                        </div>
                        <div className={`match-result result-${resultType}`}>
                            {gameResult}
                        </div>
                    </div>

                    <div className="game-controls">
                        <label className="series-toggle">
                            <input 
                                type="checkbox" 
                                checked={isSeriesMode} 
                                onChange={(e) => setIsSeriesMode(e.target.checked)}
                            />
                            🔥 5판 3선승제
                        </label>
                        <button 
                            className="start-game-btn" 
                            disabled={isPlaying || !isModelReady}
                            onClick={startChallenge}
                        >
                            {isPlaying ? '대결 중...' : '🎮 게임 시작'}
                        </button>
                        <button className="reset-game-btn" onClick={resetGame}>🔄 점수 초기화</button>
                        
                        <div className="history-wrap">
                            <span className="history-label">최근 전적</span>
                            <div className="history-list">
                                {gameHistory.map((h, i) => <span key={i} className="history-item">{h}</span>)}
                            </div>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="stats-dashboard">
                        <div className="stats-grid">
                            <div className="stat-node">
                                <span className="stat-lbl">총 게임</span>
                                <span className="stat-val">{stats.total}</span>
                            </div>
                            <div className="stat-node">
                                <span className="stat-lbl">승률</span>
                                <span className="stat-val">{winRate}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Countdown Overlay */}
            {countdown && (
                <div className="countdown-overlay">
                    <div className="countdown-text">{countdown}</div>
                </div>
            )}

            <div id="confetti-box"></div>

            <style jsx>{`
                .rps-container { width: 100%; max-width: 1000px; padding: 1rem; }
                .rps-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
                .game-layout { display: grid; grid-template-columns: 1.2fr 1fr; gap: 1.5rem; }
                
                .name-edit-box { display: flex; gap: 0.5rem; background: var(--surface); padding: 4px 8px; border-radius: 20px; border: 1px solid var(--border); }
                .name-input { background: none; border: none; width: 100px; outline: none; font-family: inherit; }
                .name-display-box { font-weight: 700; font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem; }
                .edit-btn, .save-btn { background: none; border: none; cursor: pointer; opacity: 0.6; }
                
                .mode-selector { display: flex; gap: 0.5rem; }
                .mode-btn { background: var(--surface); border: 1px solid var(--border); padding: 6px 12px; border-radius: 12px; cursor: pointer; font-size: 0.85rem; }
                .mode-btn.active { background: var(--foreground); color: white; }
                .mute-btn { background: var(--surface); border: 1px solid var(--border); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; }

                .webcam-pane { padding: 1.5rem; position: relative; min-height: 480px; }
                .webcam-view { overflow: hidden; background: #f8f9fa; border-radius: 16px; min-height: 300px; margin-bottom: 1rem; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); }
                .loader-box { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.2rem; z-index: 10; background: rgba(255,255,255,0.95); backdrop-filter: blur(8px); border-radius: 20px; text-align: center; }
                .status-emoji { font-size: 3rem; margin-bottom: -0.5rem; }
                .status-text { font-size: 1.1rem; font-weight: 500; line-height: 1.5; color: var(--foreground); }
                .init-btn { background: var(--foreground); color: white; border: none; padding: 12px 32px; border-radius: 30px; font-weight: 700; cursor: pointer; font-size: 1.1rem; transition: transform 0.2s ease; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                .init-btn:hover { transform: scale(1.05); }
                .init-btn:disabled { opacity: 0.5; cursor: wait; }
                .permission-guide { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 0.5rem; }
                .webcam-ready-info { position: absolute; top: 2.5rem; left: 2.5rem; background: rgba(255,255,255,0.8); padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; z-index: 5; backdrop-filter: blur(4px); }
                
                .prediction-labels { display: flex; flex-direction: column; gap: 0.8rem; }
                .prob-item { width: 100%; }
                .prob-text { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 4px; }
                .prob-bar-bg { background: rgba(0,0,0,0.05); height: 8px; border-radius: 4px; overflow: hidden; }
                .prob-bar-fill { height: 100%; width: 0%; transition: width 0.3s ease; }
                .fill-가위 { background-color: #FF6B6B; }
                .fill-바위 { background-color: #4ECDC4; }
                .fill-보 { background-color: #45B7D1; }
                .glow { box-shadow: 0 0 10px rgba(255,255,255,0.8); filter: brightness(1.2); }

                .score-pane { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; justify-content: center; }
                .scoreboard { display: flex; justify-content: space-between; align-items: center; background: var(--surface); padding: 1rem 1.5rem; border-radius: 16px; }
                .score-item { display: flex; flex-direction: column; align-items: center; }
                .player-label { font-size: 0.8rem; color: var(--text-secondary); }
                .score-val { font-size: 2.5rem; font-weight: 900; }
                .vs { font-weight: 700; color: var(--border); }

                .match-visual { text-align: center; }
                .match-emojis { font-size: 3.5rem; display: flex; align-items: center; justify-content: center; gap: 1rem; }
                .match-thunder { font-size: 1.5rem; opacity: 0.4; }
                .match-result { font-weight: 700; font-size: 1.2rem; margin-top: 1rem; }
                .result-win { color: #2ecc71; }
                .result-lose { color: #e74c3c; }
                .result-draw { color: var(--text-secondary); }

                .game-controls { display: flex; flex-direction: column; gap: 0.8rem; align-items: center; width: 100%; }
                .series-toggle { font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; }
                .start-game-btn { background: var(--foreground); color: white; border: none; padding: 12px 24px; border-radius: 30px; font-weight: 700; cursor: pointer; width: 100%; font-size: 1.1rem; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                .start-game-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .reset-game-btn { background: none; border: none; color: var(--text-secondary); text-decoration: underline; font-size: 0.85rem; cursor: pointer; }
                
                .history-wrap { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.4rem; margin-top: 0.5rem; }
                .history-label { font-size: 0.75rem; opacity: 0.6; }
                .history-list { display: flex; gap: 0.4rem; font-size: 1.2rem; }

                .stats-grid { display: flex; justify-content: center; gap: 1.5rem; }
                .stat-node { display: flex; flex-direction: column; align-items: center; }
                .stat-lbl { font-size: 0.75rem; opacity: 0.6; }
                .stat-val { font-weight: 700; }

                .countdown-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 2000; }
                .countdown-text { font-size: 6rem; font-weight: 900; color: white; animation: countZoom 1s ease forwards; }
                
                @keyframes countZoom {
                    0% { transform: scale(0.5); opacity: 0; }
                    50% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(1.5); opacity: 0; }
                }

                #confetti-box { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 3000; }
                :global(.confetti-piece) {
                    position: absolute; width: 10px; height: 10px; border-radius: 2px;
                    animation: fall 3s ease-in forwards;
                }
                @keyframes fall {
                    0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
                }

                @keyframes bounce {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.3); }
                }
                .bounce { animation: bounce 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275); }

                .shake-screen { animation: shake 0.5s ease-in-out; }
                @keyframes shake {
                    0%, 100% { transform: translate(0, 0); }
                    10%, 30%, 50%, 70%, 90% { transform: translate(-5px, 0); }
                    20%, 40%, 60%, 80% { transform: translate(5px, 0); }
                }

                @media (max-width: 800px) {
                    .game-layout { grid-template-columns: 1fr; }
                    .rps-header { flex-direction: column; gap: 1rem; }
                }
            `}</style>
        </div>
    );
}
