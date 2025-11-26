import React, { useEffect, useRef } from 'react';

export const TechParticles = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const mouseRef = useRef({ x: -1000, y: -1000 });
    // Smooth mouse tracking for fluid effect
    const smoothMouseRef = useRef({ x: -1000, y: -1000 }); 

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            mouseRef.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        
        class Particle {
            x: number;
            y: number;
            vx: number;
            vy: number;
            size: number;
            color: string;

            constructor() {
                if (!canvas) { // Should not happen but for safety
                    this.x = 0;
                    this.y = 0;
                } else {
                    this.x = Math.random() * canvas.width;
                    this.y = Math.random() * canvas.height;
                }
                // Constant slow drift (Much slower now: 0.2 instead of 0.4)
                this.vx = (Math.random() - 0.5) * 0.2; 
                this.vy = (Math.random() - 0.5) * 0.2;
                this.size = Math.random() * 2 + 1;
                
                // Tech colors: mostly slate, occasional purple/blue
                const rand = Math.random();
                if (rand > 0.95) this.color = 'rgba(167, 139, 250, 0.6)'; // Purple
                else if (rand > 0.9) this.color = 'rgba(96, 165, 250, 0.6)'; // Blue
                else this.color = 'rgba(148, 163, 184, 0.4)'; // Slate
            }

            update() {
                if (!canvas) return;

                // 1. Natural Drift
                this.x += this.vx;
                this.y += this.vy;

                // 2. Wrap around screen
                if (this.x < 0) this.x = canvas.width;
                if (this.x > canvas.width) this.x = 0;
                if (this.y < 0) this.y = canvas.height;
                if (this.y > canvas.height) this.y = 0;

                // 3. Fluid Mouse Interaction
                // Interpolate smooth mouse for laggy/fluid feel
                smoothMouseRef.current.x += (mouseRef.current.x - smoothMouseRef.current.x) * 0.1;
                smoothMouseRef.current.y += (mouseRef.current.y - smoothMouseRef.current.y) * 0.1;

                const dx = smoothMouseRef.current.x - this.x;
                const dy = smoothMouseRef.current.y - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                // Radius reduced slightly (was 200)
                const interactionRadius = 160;

                if (dist < interactionRadius) {
                    // Very subtle push away
                    const force = (interactionRadius - dist) / interactionRadius;
                    const angle = Math.atan2(dy, dx);
                    
                    // Force reduced significantly (was 0.05) to be a gentle nudge
                    this.vx -= Math.cos(angle) * force * 0.02; 
                    this.vy -= Math.sin(angle) * force * 0.02;
                }

                // Limit speed (Max speed reduced from 1.5 to 0.6)
                // This ensures even if pushed, they don't fly away
                const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                const maxSpeed = 0.6;
                
                if (speed > maxSpeed) {
                    this.vx = (this.vx / speed) * maxSpeed;
                    this.vy = (this.vy / speed) * maxSpeed;
                }
            }

            draw() {
                if (!ctx) return;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = this.color;
                ctx.fill();
            }
        }

        let particles: Particle[] = [];

        const init = () => {
            particles = [];
            const count = Math.floor((canvas.width * canvas.height) / 10000);
            for (let i = 0; i < count; i++) {
                particles.push(new Particle());
            }
        };

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw connections first (background layer)
            ctx.lineWidth = 0.5;
            
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.update();
                p.draw();

                // Connect to nearby particles
                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const dx = p.x - p2.x;
                    const dy = p.y - p2.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 100) {
                        ctx.beginPath();
                        // Opacity based on distance
                        ctx.strokeStyle = `rgba(148, 163, 184, ${0.15 - (dist / 100) * 0.15})`; 
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                    }
                }
            }
            animationFrameId = requestAnimationFrame(animate);
        };

        const handleResize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            init();
        };

        window.addEventListener('resize', handleResize);
        handleResize();
        animate();

        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <canvas 
            ref={canvasRef} 
            className="absolute inset-0 pointer-events-none z-0"
        />
    );
};
