import React from 'react';

interface KawaiiMascotProps {
  state?: 'idle' | 'happy' | 'thinking';
  className?: string;
}

export const KawaiiMascot: React.FC<KawaiiMascotProps> = ({ state = 'idle', className = '' }) => {
  return (
    <svg 
      viewBox="0 0 100 100" 
      className={`w-24 h-24 drop-shadow-lg ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Body */}
      <circle cx="50" cy="50" r="45" fill="#a78bfa" /> {/* kawaii-purple */}
      <circle cx="50" cy="50" r="40" fill="#ede9fe" /> {/* kawaii-purpleLight */}
      
      {/* Ears */}
      <circle cx="20" cy="20" r="15" fill="#a78bfa" />
      <circle cx="80" cy="20" r="15" fill="#a78bfa" />
      <circle cx="20" cy="20" r="10" fill="#ede9fe" />
      <circle cx="80" cy="20" r="10" fill="#ede9fe" />
      
      {/* Face */}
      {/* Eyes */}
      <ellipse cx="35" cy="45" rx="5" ry="8" fill="#4c1d95" />
      <ellipse cx="65" cy="45" rx="5" ry="8" fill="#4c1d95" />
      
      {/* Shine in eyes */}
      <circle cx="37" cy="42" r="2" fill="white" />
      <circle cx="67" cy="42" r="2" fill="white" />
      
      {/* Cheeks */}
      <circle cx="25" cy="55" r="5" fill="#fb7185" opacity="0.6" />
      <circle cx="75" cy="55" r="5" fill="#fb7185" opacity="0.6" />
      
      {/* Mouth based on state */}
      {state === 'idle' && (
        <path d="M40 60 Q50 65 60 60" stroke="#4c1d95" strokeWidth="3" fill="none" strokeLinecap="round" />
      )}
      {state === 'happy' && (
        <path d="M35 60 Q50 75 65 60" stroke="#4c1d95" strokeWidth="3" fill="none" strokeLinecap="round" />
      )}
      {state === 'thinking' && (
        <circle cx="50" cy="65" r="3" fill="#4c1d95" />
      )}
    </svg>
  );
};
