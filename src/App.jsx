import React, { useState, useEffect } from 'react';
import Landing from './Landing.jsx';
import AimTrainer from './AimTrainer.jsx';
import { getDeviceId, fetchProfile, saveProfile } from './api.js';

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

  // Unique Device ID for Cloudflare R2 Sync
  const [deviceId] = useState(() => getDeviceId());

  // Profile and High Scores State
  const [name, setName] = useState(() => localStorage.getItem('vat_name') || 'Agent');
  const [best, setBest] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('vat_best')) || { score: 0, accuracy: 0, split: 0 };
    } catch {
      return { score: 0, accuracy: 0, split: 0 };
    }
  });

  // Background Sync on Mount
  useEffect(() => {
    async function syncProfile() {
      const r2Data = await fetchProfile(deviceId);
      if (!r2Data) return;

      setBest((localBest) => {
        const r2Best = r2Data.best || { score: 0, accuracy: 0, split: 0 };
        // Merge rules: take the best metrics
        const mergedBest = {
          score: Math.max(localBest.score, r2Best.score),
          accuracy: Math.max(localBest.accuracy, r2Best.accuracy),
          split: r2Best.split > 0 ? (localBest.split ? Math.min(localBest.split, r2Best.split) : r2Best.split) : localBest.split
        };

        setName((localName) => {
          // R2 name takes precedence if local is default or r2 has a set name
          const mergedName = r2Data.name && r2Data.name !== 'Agent' ? r2Data.name : localName;
          
          // Save merged result back to localStorage
          try {
            localStorage.setItem('vat_name', mergedName);
            localStorage.setItem('vat_best', JSON.stringify(mergedBest));
          } catch (e) {}

          // If local data was better/newer than R2, push the merged stats back to R2
          const isLocalBetter = localBest.score > r2Best.score || 
                               (localBest.score === r2Best.score && localBest.accuracy > r2Best.accuracy) ||
                               (localName !== 'Agent' && r2Data.name === 'Agent');
          if (isLocalBetter) {
            saveProfile(deviceId, mergedName, mergedBest);
          }

          return mergedName;
        });

        return mergedBest;
      });
    }

    syncProfile();
  }, [deviceId]);

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

  const handleSetName = (updater) => {
    setName((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('vat_name', next);
      } catch (e) {}
      saveProfile(deviceId, next, best);
      return next;
    });
  };

  const handleSetBest = (updater) => {
    setBest((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('vat_best', JSON.stringify(next));
      } catch (e) {}
      saveProfile(deviceId, name, next);
      return next;
    });
  };

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
        name={name}
        setName={handleSetName}
        best={best}
      />
    );
  }
  return (
    <AimTrainer
      onExit={() => setView('landing')}
      lang={lang}
      setLang={handleSetLang}
      isMobile={isMobile}
      best={best}
      setBest={handleSetBest}
    />
  );
}
