import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../utils/api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [email, setEmail] = useState('');
    const [authLoading, setAuthLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        let isCancelled = false;
        async function hydrateSession() {
            try {
                const session = await API.getSession();
                if (!isCancelled) {
                    setEmail(session.email || '');
                    setIsAuthenticated(Boolean(session.email));
                }
            } catch (err) {
                if (!isCancelled) {
                    setEmail('');
                    setIsAuthenticated(false);
                }
            } finally {
                if (!isCancelled) setAuthLoading(false);
            }
        }

        hydrateSession();
        return () => { isCancelled = true; };
    }, []);

    const login = async (jwt) => {
        const session = await API.createSession(jwt);
        setEmail(session.email || '');
        setIsAuthenticated(Boolean(session.email));
        navigate('/dashboard');
    };

    const logout = async () => {
        try {
            await API.logoutSession();
        } catch (err) {
            // Non-fatal: proceed with local auth reset even if request fails.
        }
        setEmail('');
        setIsAuthenticated(false);
        navigate('/');
    };

    return (
        <AuthContext.Provider value={{ email, login, logout, isAuthenticated, authLoading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
