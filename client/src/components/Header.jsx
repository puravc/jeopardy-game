import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Header() {
    const { isAuthenticated, email, logout } = useAuth();
    const location = useLocation();

    // Do not show global header on the landing page if not authenticated
    if (!isAuthenticated && location.pathname === '/') {
        return null; 
    }

    // Player buzzer view should be immersive and not show the global auth header.
    if (location.pathname.startsWith('/play/')) {
        return null; 
    }

    return (
        <header className="app-header">
            <Link to={isAuthenticated ? '/dashboard' : '/'} className="logo">
                <div className="logo-icon">🎯</div>
                <span className="logo-text">JEOPARDY!</span>
            </Link>
            
            <nav className="header-nav">
                {isAuthenticated && (
                    <Link to="/dashboard" className="btn btn-ghost btn-sm">Dashboard</Link>
                )}
            </nav>

            {isAuthenticated && (
                <div style={{ display: 'flex', color: 'var(--text-secondary)', fontSize: '0.9rem', marginLeft: '1rem', alignItems: 'center' }}>
                    <span style={{ marginRight: '0.5rem' }}>{email}</span>
                    <button className="btn btn-ghost btn-sm" onClick={logout}>Sign Out</button>
                </div>
            )}
        </header>
    );
}
