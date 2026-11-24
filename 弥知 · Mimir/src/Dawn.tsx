import { useEffect, useRef, useState } from "react";
import "./dawn.css";

const PETALS = [
  { rotate: -12, scaleY: 1 },
  { rotate: 28, scaleY: 0.72 },
  { rotate: 74, scaleY: 1 },
  { rotate: 118, scaleY: 0.62 },
  { rotate: 168, scaleY: 1 },
  { rotate: 214, scaleY: 0.7 },
  { rotate: 258, scaleY: 1 },
  { rotate: 312, scaleY: 0.58 },
];

export function Dawn({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"night" | "rise" | "day" | "leave">("night");
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase("rise"), 700),
      window.setTimeout(() => setPhase("day"), 2300),
      window.setTimeout(() => setPhase("leave"), 4700),
      window.setTimeout(() => done.current(), 5400),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  return (
    <div className={`dawn dawn-${phase}`} role="dialog" aria-label="弥知开场">
      <div className="dawn-sky" />
      <div className="dawn-sky dawn-sky-day" />
      <Clouds tone="ink" />
      <Clouds tone="day" />
      <div className="dawn-sun">
        <div className="dawn-halo" />
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <radialGradient id="mizhi-sun" cx="50%" cy="46%" r="58%">
              <stop offset="0%" stopColor="#fff6ea" />
              <stop offset="42%" stopColor="#f0b48a" />
              <stop offset="100%" stopColor="#c96442" />
            </radialGradient>
          </defs>
          <circle className="dawn-core" cx="32" cy="32" r="15" fill="url(#mizhi-sun)" />
          {PETALS.map((petal, index) => (
            <g key={petal.rotate} className="dawn-petal" style={{ transitionDelay: `${0.08 + index * 0.07}s` }}>
              <g transform={`translate(32 32) rotate(${petal.rotate}) scale(0.56 ${0.56 * petal.scaleY})`}>
                <path fill="#fff8f2" d="M0 0C-7.2-6-6.6-18 0-24C6.6-18 7.2-6 0 0Z" />
              </g>
            </g>
          ))}
        </svg>
        <p className="dawn-name">弥知</p>
      </div>
      <Waves tone="ink" fill={["#050508", "#0c0b10", "#16141a"]} />
      <Waves tone="day" fill={["#1b4d5c", "#2f8a86", "#9fd9cf"]} />
      <div className="dawn-glint" />
      <button type="button" className="dawn-skip" onClick={() => done.current()}>跳过</button>
    </div>
  );
}

function Clouds({ tone }: { tone: "ink" | "day" }) {
  return (
    <div className={`dawn-clouds is-${tone}`} aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className={`dawn-cloud cloud-${index}`}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function Waves({ tone, fill }: { tone: "ink" | "day"; fill: [string, string, string] }) {
  const crests = [108, 142, 176];
  const speeds = ["13s", "8s", "5.6s"];
  return (
    <div className={`dawn-sea sea-${tone}`} aria-hidden="true">
      {fill.map((color, index) => (
        <div key={color} className="sea-band" style={{ animationDuration: speeds[index] }}>
          <Wave color={color} crest={crests[index]} />
          <Wave color={color} crest={crests[index]} />
        </div>
      ))}
    </div>
  );
}

function Wave({ color, crest }: { color: string; crest: number }) {
  const path = `M0 ${crest} C80 ${crest - 34} 160 ${crest + 26} 240 ${crest} S400 ${crest - 34} 480 ${crest} S640 ${crest + 26} 720 ${crest} S880 ${crest - 34} 960 ${crest} S1120 ${crest + 26} 1200 ${crest} V280 H0 Z`;
  return (
    <svg viewBox="0 0 1200 280" preserveAspectRatio="none">
      <path fill={color} d={path} />
    </svg>
  );
}
