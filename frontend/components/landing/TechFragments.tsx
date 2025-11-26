import React from 'react';
import { Search } from 'lucide-react';

const UI_FRAGMENTS = [
    // Tech elements: Search bars, cursors, loading spinners
    { type: 'search', x: 15, y: 20, delay: 0 },
    { type: 'cursor', x: 80, y: 15, delay: 2 },
    { type: 'code', x: 75, y: 65, delay: 1 },
    { type: 'spinner', x: 10, y: 70, delay: 3 },
    { type: 'bracket', x: 88, y: 85, delay: 1.5 },
];

export const TechFragments = ({ mousePos }: { mousePos: { x: number, y: number } }) => {
    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
            {UI_FRAGMENTS.map((item, i) => (
                <div
                    key={i}
                    className="absolute transition-transform duration-[2000ms] ease-out will-change-transform opacity-60"
                    style={{
                        left: `${item.x}%`,
                        top: `${item.y}%`,
                        transform: `
                            translate(${mousePos.x * (i % 2 === 0 ? 20 : -20)}px, ${mousePos.y * (i % 2 === 0 ? 20 : -20)}px) 
                        `,
                        animation: `float ${10 + i * 2}s ease-in-out infinite`,
                        animationDelay: `${item.delay}s`
                    }}
                >
                    {item.type === 'search' && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm text-slate-300">
                             <Search size={14} />
                             <div className="w-12 h-1 bg-slate-100 rounded-full" />
                        </div>
                    )}
                    {item.type === 'cursor' && (
                        <div className="text-kawaii-blue">
                             <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M5.63605 4.54581L18.4645 10.6069L11.8995 12.5262L10.2837 19.0912L5.63605 4.54581Z" /></svg>
                        </div>
                    )}
                    {item.type === 'code' && (
                        <div className="flex flex-col gap-1 p-2 bg-slate-900/5 rounded-lg">
                            <div className="w-16 h-1 bg-slate-300 rounded-full" />
                            <div className="w-10 h-1 bg-kawaii-purple/50 rounded-full ml-2" />
                            <div className="w-12 h-1 bg-slate-300 rounded-full" />
                        </div>
                    )}
                    {item.type === 'spinner' && (
                        <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-kawaii-mint animate-spin" />
                    )}
                     {item.type === 'bracket' && (
                        <div className="text-4xl font-mono font-bold text-slate-100">{`}`}</div>
                    )}
                </div>
            ))}
        </div>
    );
};
