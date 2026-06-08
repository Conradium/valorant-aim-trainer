import React, { useState, useEffect } from 'react';
import Landing from './Landing.jsx';
import AimTrainer from './AimTrainer.jsx';

export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'play'
  const [lang, setLang] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('vat_settings'));
      return saved && saved.lang ? saved.lang : 'en';
    } catch {
      return 'en';
    }
  });

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    const ua = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i.test(
      navigator.userAgent || ''
    );
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    const noLock = !document.documentElement.requestPointerLock;
    return ua || coarse || noLock || window.innerWidth < 1024;
  });

  useEffect(() => {
    const check = () => {
      const ua = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i.test(
        navigator.userAgent || ''
      );
      const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
      const noLock = !document.documentElement.requestPointerLock;
      setIsMobile(ua || coarse || noLock || window.innerWidth < 1024);
    };
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleSetLang = (newLang) => {
    setLang(newLang);
    try {
      const saved = JSON.parse(localStorage.getItem('vat_settings')) || {};
      saved.lang = newLang;
      localStorage.setItem('vat_settings', JSON.stringify(saved));
    } catch {
      /* ignore */
    }
  };

  if (view === 'landing') {
    return (
      <Landing
        onPlay={() => setView('play')}
        lang={lang}
        setLang={handleSetLang}
        isMobile={isMobile}
      />
    );
  }
  return (
    <AimTrainer
      onExit={() => setView('landing')}
      lang={lang}
      setLang={handleSetLang}
      isMobile={isMobile}
    />
  );
}
