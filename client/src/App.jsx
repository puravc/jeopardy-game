import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Header from './components/Header';
import LandingPage from './pages/LandingPage';
import AdminDashboard from './pages/AdminDashboard';
import JoinGameView from './pages/JoinGameView';
import HostGameView from './pages/HostGameView';
import PlayerBuzzerView from './pages/PlayerBuzzerView';
import QuestionBankView from './pages/QuestionBankView';

function App() {
  return (
    <AuthProvider>
      <Header />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<AdminDashboard />} />
        <Route path="/question-bank" element={<QuestionBankView />} />
        <Route path="/join" element={<JoinGameView />} />
        <Route path="/host/:gameId" element={<HostGameView />} />
        <Route path="/play/:gameId" element={<PlayerBuzzerView />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
