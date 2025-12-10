"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { friendlyMessageForStatus } from "@/hooks/useAuthFetch";
import { ArrowRight, Terminal, LayoutGrid, Command } from 'lucide-react';
import { KawaiiMascot } from "@/components/landing/KawaiiMascot";
import { TechParticles } from "@/components/landing/TechParticles";
import { TechFragments } from "@/components/landing/TechFragments";
import { TiltCard } from "@/components/landing/TiltCard";

export default function LoginPage() {
  const router = useRouter();
  const { setAccessToken } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Landing Page States
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isExiting, setIsExiting] = useState(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    // Normalize mouse position for parallax (-1 to 1)
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = (e.clientY / window.innerHeight) * 2 - 1;
    setMousePos({ x, y });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError("用户名和密码不能为空");
      return;
    }

    setIsSubmitting(true);

    try {
      const { API_ROUTES } = await import("@/lib/api-routes");
      const response = await fetch(API_ROUTES.AUTH.login(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
        }),
      });

      if (!response.ok) {
        setError(friendlyMessageForStatus(response.status, "login"));
        return;
      }

      const { access_token: accessToken } = (await response.json()) as {
        access_token: string;
      };

      setAccessToken(accessToken);
      
      // Start exit animation
      setIsExiting(true);
      setTimeout(() => {
        router.push("/");
      }, 800);
      
    } catch (err) {
      console.error("登录失败", err);
      setError("登录失败，请稍后再试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      className={`relative w-screen h-screen overflow-hidden bg-[#f8fafc] flex items-center justify-center transition-all duration-700 ${isExiting ? 'opacity-0 scale-95 blur-sm' : 'opacity-100'}`}
      onMouseMove={handleMouseMove}
    >
      {/* --- 1. Engineering Grid Background (Tech Foundation) --- */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-[0.4]"
           style={{
             backgroundImage: `linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)`,
             backgroundSize: '40px 40px'
           }}
      />
      
      {/* --- 2. Natural Flow Particles (Subtle Interaction) --- */}
      <TechParticles />

      {/* --- 3. Floating UI Fragments (Tech/Kawaii Mix) --- */}
      <TechFragments mousePos={mousePos} />

      {/* --- 4. Main Interface --- */}
      <div className="relative z-10 w-full max-w-5xl px-6 grid grid-cols-1 md:grid-cols-12 gap-12 items-center">
        
        {/* Left: Product Value */}
        <div className="md:col-span-7 space-y-8 text-center md:text-left">
          
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-full shadow-sm animate-fade-in-up">
            <span className="flex h-2 w-2 relative">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-kawaii-mint opacity-75"></span>
               <span className="relative inline-flex rounded-full h-2 w-2 bg-kawaii-mint"></span>
            </span>
            <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Build v2.4</span>
          </div>
          
          {/* Headline */}
          <div className="space-y-4">
            <h1 className="text-5xl md:text-7xl font-display font-bold text-slate-800 leading-[1.1] tracking-tight animate-fade-in-up delay-100">
              Resume <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-kawaii-purple to-kawaii-blue">
                Engineering
              </span>
            </h1>
            <p className="text-lg text-slate-500 font-medium max-w-lg mx-auto md:mx-0 leading-relaxed animate-fade-in-up delay-200 font-sans">
              A structured, block-based editor for crafting professional identities. 
              <span className="text-kawaii-purple/80"> Simple enough for humans, precise enough for machines.</span>
            </p>
          </div>

          {/* Action Area - Visual Only in Login Page */}
          <div className="pt-2 animate-fade-in-up delay-300 flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
            <div 
              className="group relative px-8 py-3.5 bg-slate-800 text-white rounded-xl font-bold shadow-lg shadow-slate-300 flex items-center justify-center gap-3 cursor-default"
            >
              <Terminal size={18} className="text-kawaii-purpleLight" />
              <span>Initialize Editor</span>
              <ArrowRight size={16} className="opacity-50" />
            </div>
            
            <div className="px-8 py-3.5 bg-white text-slate-600 rounded-xl font-bold border border-slate-200 flex items-center justify-center gap-2 cursor-default">
              <LayoutGrid size={18} />
              <span>View Templates</span>
            </div>
          </div>
        </div>

        {/* Right: Login Interface (Clean & Rounded) */}
        <div className="md:col-span-5 perspective-1000">
            <TiltCard mousePos={mousePos}>
                <div className="relative bg-white/90 backdrop-blur-xl border border-white/60 p-8 rounded-[2rem] shadow-card ring-1 ring-slate-900/5">
                    
                    {/* Mascot peeking */}
                    <div className="absolute -top-12 right-6 z-20 pointer-events-none scale-75 origin-bottom-right">
                        <KawaiiMascot state={isSubmitting ? "thinking" : (username && password ? "happy" : "idle")} />
                    </div>

                    <div className="space-y-6 relative z-10">
                        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                            <div className="w-10 h-10 rounded-xl bg-kawaii-purple/10 flex items-center justify-center text-kawaii-purple">
                                <Command size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-800">Auth Required</h2>
                                <p className="text-xs text-slate-400 font-mono">Secure Session</p>
                            </div>
                        </div>

                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div className="space-y-1.5">
                                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider ml-1">Username</label>
                                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 transition-colors focus-within:border-kawaii-blue focus-within:bg-white focus-within:ring-2 focus-within:ring-kawaii-blue/10">
                                    <input 
                                        type="text" 
                                        placeholder="Enter your username"
                                        className="w-full bg-transparent border-none px-1 py-2.5 outline-none text-sm text-slate-700 font-medium placeholder:text-slate-300" 
                                        value={username}
                                        onChange={(event) => setUsername(event.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider ml-1">Password</label>
                                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 transition-colors focus-within:border-kawaii-purple focus-within:bg-white focus-within:ring-2 focus-within:ring-kawaii-purple/10">
                                    <input 
                                        type="password" 
                                        placeholder="••••••••"
                                        className="w-full bg-transparent border-none px-1 py-2.5 outline-none text-sm text-slate-700 font-medium placeholder:text-slate-300" 
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 border border-red-100">
                                    {error}
                                </div>
                            )}

                            <button 
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full py-3 bg-gradient-to-r from-kawaii-blue to-kawaii-purple text-white rounded-xl font-bold transition-transform active:scale-95 shadow-lg shadow-kawaii-blue/20 hover:shadow-kawaii-blue/30 text-sm tracking-wide disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? "Connecting..." : "Connect"}
                            </button>
                        </form>
                    </div>
                </div>
            </TiltCard>
        </div>
      </div>
    </div>
  );
}
