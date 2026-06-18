import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { theme } from '../theme';

const Card: React.FC<{
  delay: number;
  value: string;
  label: string;
  frame: number;
  fps: number;
}> = ({ delay, value, label, frame, fps }) => {
  const f = frame - delay;
  const scale = spring({
    frame: f,
    fps,
    config: { damping: 200, mass: 0.5 },
    durationInFrames: 26,
  });
  const opacity = interpolate(f, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const underline = interpolate(f, [14, 36], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        opacity,
        background: theme.bgRaised,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 22,
        padding: '52px 68px 60px 68px',
        minWidth: 400,
        textAlign: 'center',
        position: 'relative',
      }}
    >
      <div
        style={{
          fontFamily: 'Inter',
          fontSize: 124,
          fontWeight: 800,
          color: theme.white,
          letterSpacing: -4,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 20,
          fontFamily: 'JetBrains Mono',
          fontSize: 24,
          color: theme.whiteDim,
          letterSpacing: 3,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: `translateX(-50%) scaleX(${underline})`,
          transformOrigin: 'center',
          width: '60%',
          height: 3,
          background: theme.solGreen,
          boxShadow: `0 0 14px ${theme.solGreen}`,
        }}
      />
    </div>
  );
};

export const Metrics: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sceneIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const sceneOut = interpolate(frame, [80, 90], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity: sceneIn * sceneOut,
        flexDirection: 'row',
        gap: 44,
      }}
    >
      <Card delay={0} value="256B" label="groth16 proof" frame={frame} fps={fps} />
      <Card delay={10} value="180k" label="cu verify" frame={frame} fps={fps} />
      <Card delay={20} value="<50ms" label="settle" frame={frame} fps={fps} />
    </AbsoluteFill>
  );
};
