import React from 'react';

export const TiltCard = ({ children, mousePos }: { children?: React.ReactNode, mousePos: {x:number, y:number} }) => {
    // Very subtle tilt, solid feel
    const rotateX = mousePos.y * -1.5; 
    const rotateY = mousePos.x * 1.5; 
    
    return (
        <div 
            className="transition-transform duration-200 ease-out will-change-transform"
            style={{ 
                transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
                transformStyle: 'preserve-3d' 
            }}
        >
            {children}
        </div>
    );
};
