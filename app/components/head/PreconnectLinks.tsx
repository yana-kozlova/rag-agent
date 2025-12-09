'use client';

import { useEffect } from 'react';

export function PreconnectLinks() {
  useEffect(() => {
    const domains = ['https://lh3.googleusercontent.com'];
    domains.forEach(domain => {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = domain;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    });
  }, []);
  
  return null;
}

