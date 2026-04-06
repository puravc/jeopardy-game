import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API } from '../utils/api';

export default function LandingPage() {
    const { login } = useAuth();
    const btnRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        let attempts = 0;

        const initGoogle = (clientId) => {
            if (cancelled) return;
            if (window.google && btnRef.current) {
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: (response) => {
                        if (response.credential) {
                            login(response.credential).catch((err) => {
                                console.error('Failed to establish admin session:', err);
                                alert(err.message || 'Unable to sign in right now. Please try again.');
                            });
                        }
                    }
                });
                window.google.accounts.id.renderButton(
                    btnRef.current,
                    { theme: "outline", size: "large", type: "standard" }
                );
            } else if (attempts < 50) {
                attempts++;
                setTimeout(() => initGoogle(clientId), 100);
            }
        };

        API.getConfig()
            .then(config => {
                if (!cancelled) initGoogle(config.googleClientId);
            })
            .catch((err) => {
                console.error('Failed to fetch config for Google Sign-In:', err);
                const fallbackId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
                if (!cancelled && fallbackId) {
                    initGoogle(fallbackId);
                } else if (!cancelled) {
                    console.error('Google client_id is not configured. Set GOOGLE_CLIENT_ID on the server.');
                }
            });

        return () => { cancelled = true; };
    }, [login]);

    return (
        <div id="landing-page">
            <nav className="landing-nav" id="landing-nav">
                <a href="#" className="landing-logo">
                    <div className="landing-logo-icon">🎯</div>
                    <span className="landing-logo-text">JEOPARDY LIVE</span>
                </a>
                <div className="landing-nav-links">
                    <a href="#features" className="landing-nav-link">Features</a>
                    <a href="#how-it-works" className="landing-nav-link">How It Works</a>
                </div>
                <div id="google-signin-container" style={{ display: 'flex', alignItems: 'center' }}>
                    <div ref={btnRef}></div>
                </div>
            </nav>

            <section className="landing-hero" id="hero">
                <div className="hero-bg-orb hero-orb-1"></div>
                <div className="hero-bg-orb hero-orb-2"></div>
                <div className="hero-bg-orb hero-orb-3"></div>
                <div className="hero-content">
                    <div className="hero-eyebrow">JEOPARDY</div>
                    <h1 className="hero-headline">
                        The Ultimate<br />
                        <em className="hero-gold">Trivia</em> Experience
                    </h1>
                    <p className="hero-tagline">Step into the spotlight. Host and play high-stakes Jeopardy-style games with the full energy of a live broadcast.</p>
                    <div className="hero-cta-group">
                        <a href="#cta" className="btn btn-gold btn-xl hero-cta-primary">Get Started</a>
                        <a href="#features" className="btn btn-outline-hero btn-xl">Learn More</a>
                        <Link to="/join" className="btn btn-outline-hero btn-xl">Join a Game</Link>
                    </div>
                </div>
                <div className="hero-board-preview">
                    <div className="hero-board-grid">
                        <div className="hb-cat">Science</div><div className="hb-cat">History</div><div className="hb-cat">Pop Culture</div>
                        <div className="hb-tile hb-tile--answered"></div>
                        <div className="hb-tile" style={{'--delay': '0.1s'}}>$200</div>
                        <div className="hb-tile" style={{'--delay': '0.2s'}}>$200</div>
                        <div className="hb-tile" style={{'--delay': '0.3s'}}>$400</div>
                        <div className="hb-tile hb-tile--active" style={{'--delay': '0.4s'}}>$400</div>
                        <div className="hb-tile" style={{'--delay': '0.5s'}}>$400</div>
                        <div className="hb-tile" style={{'--delay': '0.6s'}}>$600</div>
                        <div className="hb-tile" style={{'--delay': '0.7s'}}>$600</div>
                        <div className="hb-tile hb-tile--answered"></div>
                        <div className="hb-tile" style={{'--delay': '0.9s'}}>$800</div>
                        <div className="hb-tile" style={{'--delay': '1.0s'}}>$800</div>
                        <div className="hb-tile hb-tile--answered"></div>
                        <div className="hb-tile" style={{'--delay': '1.2s'}}>$1000</div>
                        <div className="hb-tile" style={{'--delay': '1.3s'}}>$1000</div>
                        <div className="hb-tile hb-tile--answered"></div>
                    </div>
                </div>
            </section>

            <section className="landing-features" id="features">
                <div className="landing-section-inner">
                    <div className="landing-section-header">
                        <h2 className="landing-section-title">Production <span className="text-gold">Value</span> In Every Click</h2>
                        <p className="landing-section-sub">We didn't just build a game; we built a broadcast studio in your browser.</p>
                    </div>
                    <div className="features-grid">
                        <div className="feature-card">
                            <div className="feature-icon">✨</div>
                            <h3 className="feature-title">Custom Question Generation</h3>
                            <p className="feature-desc">Our AI generates professional-grade clues across any topic, ensuring your game is always fresh and challenging.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">👥</div>
                            <h3 className="feature-title">Massive Multiplayer</h3>
                            <p className="feature-desc">Connect up to 50 players in real-time. Zero lag, instant buzzer responses, and dynamic leaderboards.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">🎙️</div>
                            <h3 className="feature-title">Easy Hosting</h3>
                            <p className="feature-desc">Control the stage with a dedicated host dashboard. Trigger sound effects, manage scores, and keep the energy flowing.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">📺</div>
                            <h3 className="feature-title">TV-Ready Graphics</h3>
                            <p className="feature-desc">Every game looks like a million-dollar production with cinematic animations and sharp typography.</p>
                        </div>
                    </div>
                </div>
            </section>

            <section className="landing-how" id="how-it-works">
                <div className="landing-section-inner">
                    <div className="landing-section-header">
                        <h2 className="landing-section-title">How to <em className="text-gold">Win</em></h2>
                        <div className="landing-divider"></div>
                    </div>
                    <div className="how-steps">
                        <div className="how-step">
                            <div className="how-step-num">01</div>
                            <h3 className="how-step-title">Create Your Stage</h3>
                            <p className="how-step-desc">Choose your theme. Our AI generates a balanced board across 6 categories. Customize every clue and $ value.</p>
                        </div>
                        <div className="how-step-arrow">→</div>
                        <div className="how-step">
                            <div className="how-step-num">02</div>
                            <h3 className="how-step-title">Invite the Audience</h3>
                            <p className="how-step-desc">Share your unique room code. Players join instantly from any device — no app download or login required to play.</p>
                        </div>
                        <div className="how-step-arrow">→</div>
                        <div className="how-step">
                            <div className="how-step-num">03</div>
                            <h3 className="how-step-title">Host the Broadcast</h3>
                            <p className="how-step-desc">Take the mic. Control the pace, read the clues with Wisecracker precision, and crown your game champion.</p>
                        </div>
                    </div>
                </div>
            </section>

            <section className="landing-cta" id="cta">
                <div className="landing-section-inner">
                    <h2 className="cta-title">Ready to <em className="text-gold">Play?</em></h2>
                    <p className="cta-sub">Sign in to start hosting high-impact trivia events every single day.</p>
                    <div className="cta-signin-wrap">
                        <a href="#hero" className="btn btn-gold btn-xl">Get Started →</a>
                    </div>
                </div>
                <div className="cta-bg-glow"></div>
            </section>

            <footer className="landing-footer">
                <div className="landing-footer-inner">
                    <span className="landing-logo-text" style={{ fontSize: '1rem', opacity: 0.7 }}>JEOPARDY LIVE</span>
                    <span className="footer-copy">© 2024 The Daily Broadcast. All rights reserved.</span>
                </div>
            </footer>
        </div>
    );
}
