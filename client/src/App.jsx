import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/AuthContext';
import Header from './components/Header';
import LandingPage from './pages/LandingPage';
import AdminDashboard from './pages/AdminDashboard';
import JoinGameView from './pages/JoinGameView';
import HostGameView from './pages/HostGameView';
import PlayerBuzzerView from './pages/PlayerBuzzerView';
import QuestionBankView from './pages/QuestionBankView';

function ProtectedRoute({ children }) {
  const { isAuthenticated, authLoading } = useAuth();
  if (authLoading) {
    return <div className="app-wrapper" style={{ padding: '2rem' }}>Loading...</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  return (
    <AuthProvider>
      <Header />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
        <Route path="/question-bank" element={<ProtectedRoute><QuestionBankView /></ProtectedRoute>} />
        <Route path="/join" element={<JoinGameView />} />
        <Route path="/host/:gameId" element={<ProtectedRoute><HostGameView /></ProtectedRoute>} />
        <Route path="/play/:gameId" element={<PlayerBuzzerView />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
