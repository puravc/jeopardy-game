import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem('admin_token'));
    const [email, setEmail] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                if (payload.exp * 1000 > Date.now()) {
                    setEmail(payload.email);
                } else {
                    logout();
                }
            } catch (e) {
                logout();
            }
        }
    }, [token]);

    const login = (jwt) => {
        localStorage.setItem('admin_token', jwt);
        setToken(jwt);
        navigate('/dashboard');
    };

    const logout = () => {
        localStorage.removeItem('admin_token');
        setToken(null);
        setEmail('');
        navigate('/');
    };

    return (
        <AuthContext.Provider value={{ token, email, login, logout, isAuthenticated: !!token }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
