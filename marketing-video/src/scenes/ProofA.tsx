import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { theme } from '../theme';

export const ProofA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sceneIn = interpolate(frame, [0, 14], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const sceneOut = interpolate(frame, [168, 180], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const slide = spring({
    frame: frame - 4,
    fps,
    config: { damping: 200, mass: 0.8 },
    durationInFrames: 36,
  });
  const imgOffsetX = (1 - slide) * 260;
  const imgOpacity = interpolate(frame, [4, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const drift = interpolate(frame, [0, 180], [0, -28]);

  const pillOpacity = interpolate(frame, [42, 68], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const pillY = interpolate(frame, [42, 68], [14, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const tagOpacity = interpolate(frame, [78, 102], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: sceneIn * sceneOut }}>
      <div
        style={{
          position: 'absolute',
          top: 70,
          left: '50%',
          width: 1520,
          transform: `translateX(calc(-50% + ${imgOffsetX + drift}px))`,
          opacity: imgOpacity,
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow:
            '0 50px 140px rgba(20, 241, 149, 0.18), 0 0 0 1px rgba(255,255,255,0.06)',
        }}
      >
        <Img
          src={staticFile('screenshots/landing.png')}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 280,
          background:
            'linear-gradient(180deg, rgba(10,10,15,0) 0%, rgba(10,10,15,0.95) 70%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          bottom: 110,
          left: '50%',
          transform: `translateX(-50%) translateY(${pillY}px)`,
          opacity: pillOpacity,
          background: theme.bgRaised,
          border: `1px solid ${theme.solGreen}`,
          borderRadius: 999,
          padding: '20px 38px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          fontFamily: 'JetBrains Mono',
          fontSize: 34,
          color: theme.white,
          letterSpacing: 1,
          boxShadow: `0 0 50px ${theme.solGreenSoft}`,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: theme.solGreen,
            boxShadow: `0 0 14px ${theme.solGreen}`,
          }}
        />
        live on devnet · meetcivitas.xyz
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 56,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: tagOpacity,
          fontFamily: 'JetBrains Mono',
          fontSize: 22,
          color: theme.whiteFaint,
          letterSpacing: 3,
          textTransform: 'uppercase',
        }}
      >
        anchor 0.31 · token-2022 vault · groth16 verifier
      </div>
    </AbsoluteFill>
  );
};
