import { useState, useEffect, useRef } from 'react';
import { API } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export function useGameState(gameId, isHost = true) {
    const [game, setGame] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [socketConnected, setSocketConnected] = useState(false);
    
    // Realtime events queue or active modal state
    const [activeQuestion, setActiveQuestion] = useState(null);
    const [buzzerQueue, setBuzzerQueue] = useState([]);
    const [questionTimer, setQuestionTimer] = useState(null);

    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const latestPlayersRef = useRef(null);
    const gameRef = useRef(null);
    const loadGameRef = useRef(null);

    const getComparableSnapshot = (snapshot) => ({
        status: snapshot?.status || null,
        players: (snapshot?.players || []).map(player => ({
            id: player.id,
            name: player.name,
            score: player.score
        })),
        categories: (snapshot?.categories || []).map(category => ({
            id: category.id,
            name: category.name,
            questionCount: category.questions?.length || 0,
            questionIds: (category.questions || []).map(question => question.id),
        })),
    });

    const haveMeaningfulChanges = (currentSnapshot, nextSnapshot) => {
        return JSON.stringify(getComparableSnapshot(currentSnapshot)) !== JSON.stringify(getComparableSnapshot(nextSnapshot));
    };

    useEffect(() => {
        loadGame();
        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, [gameId]);

    useEffect(() => {
        gameRef.current = game;
    }, [game]);

    useEffect(() => {
        loadGameRef.current = loadGame;
    }, [loadGame]);

    useEffect(() => {
        if (isHost) return;

        const interval = setInterval(() => {
            loadGameRef.current?.();
        }, 5000);

        return () => clearInterval(interval);
    }, [isHost, gameId]);

    async function loadGame() {
        if (!game) setLoading(true);
        console.log('useGameState: loadGame starting for', gameId);
        try {
            const data = isHost ? await API.getGame(gameId) : await API.getPublicGame(gameId);
            const mergedGame = latestPlayersRef.current?.length
                ? { ...data, players: latestPlayersRef.current }
                : data;
            if (!gameRef.current || haveMeaningfulChanges(gameRef.current, mergedGame)) {
                setGame(mergedGame);
            }
            if (isHost && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
                connectWebSocket();
            }
        } catch (e) {
            console.error('useGameState: loadGame error', e);
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    const connectWebSocket = (playerName = null, playerId = null) => {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = import.meta.env.PROD ? window.location.host : 'localhost:3000';
        const ws = new WebSocket(`${proto}://${host}`);

        const playBuzzSound = () => {
            if (!isHost || typeof window === 'undefined') return;
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextCtor) return;

            if (!audioContextRef.current) {
                audioContextRef.current = new AudioContextCtor();
            }

            const audioContext = audioContextRef.current;
            if (audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }

            const now = audioContext.currentTime;
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(880, now);
            oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.12);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start(now);
            oscillator.stop(now + 0.2);
        };

        ws.onopen = () => {
            setSocketConnected(true);
            ws.send(JSON.stringify({ 
                type: isHost ? 'host_join' : 'player_join', 
                gameId,
                playerName: playerName,
                playerId: playerId
            }));
        };

        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            
            if (msg.type === 'player_joined') {
                setGame(prev => ({ ...prev, myId: msg.playerId }));
                if (msg.questionOpen) {
                    setQuestionTimer(msg.timeoutAt || Date.now() + 15000);
                }
            }
            if (msg.type === 'game_players_update' || msg.type === 'player_list') {
                latestPlayersRef.current = msg.players || [];
                setGame(prev => ({ ...(prev || {}), players: msg.players || [] }));
            }
            if (msg.type === 'buzzer_update') {
                setBuzzerQueue(msg.queue || []);
            }
            if (msg.type === 'game_update' && msg.game) {
                if (Array.isArray(msg.game.players)) {
                    latestPlayersRef.current = msg.game.players;
                }
                setGame(prev => ({
                    ...(prev || {}),
                    ...msg.game,
                    players: Array.isArray(msg.game.players) ? msg.game.players : (prev?.players || [])
                }));
            }
            if (msg.type === 'buzz') {
                if (isHost) playBuzzSound();
                if (msg.queue) setBuzzerQueue(msg.queue);
            }
            if (msg.type === 'question_open') {
                setQuestionTimer(msg.timeoutAt);
            }
            if (msg.type === 'question_closed') {
                setQuestionTimer(null);
                setBuzzerQueue([]);
            }
            if (msg.type === 'score_update') {
                if (Array.isArray(msg.players)) {
                    latestPlayersRef.current = msg.players;
                }
                setGame(prev => {
                    if (Array.isArray(msg.players)) {
                        return { ...(prev || {}), players: msg.players };
                    }

                    const updatedPlayers = (prev?.players || []).map(player => {
                        if (msg.event?.playerId && player.id === msg.event.playerId && typeof msg.event.amount === 'number') {
                            return { ...player, score: (player.score || 0) + msg.event.amount };
                        }
                        return player;
                    });

                    return { ...(prev || {}), players: updatedPlayers };
                });
            }
            if (msg.type === 'game_status_update') {
                setGame(prev => ({ ...prev, status: msg.status }));
            }
        };

        ws.onclose = () => setSocketConnected(false);
        wsRef.current = ws;
    };

    const sendSocketMessage = (data) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // Include playerId automatically if it's a player message
            const payload = { ...data, gameId };
            if (!isHost && game?.myId) payload.playerId = game.myId;
            wsRef.current.send(JSON.stringify(payload));
        }
    };

    return {
        game,
        setGame,
        loading,
        error,
        socketConnected,
        activeQuestion,
        setActiveQuestion,
        buzzerQueue,
        setBuzzerQueue,
        questionTimer,
        sendSocketMessage,
        loadGame,
        connectWebSocket
    };
}
