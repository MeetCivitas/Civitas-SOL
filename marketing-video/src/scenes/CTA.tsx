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

export const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sceneIn = interpolate(frame, [0, 14], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 200, mass: 0.5 },
    durationInFrames: 26,
  });
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const urlOpacity = interpolate(frame, [14, 34], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const urlY = interpolate(frame, [14, 34], [12, 0], {
    extrapolateRight: 'clamp',
  });

  const signOpacity = interpolate(frame, [28, 48], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const partnerOpacity = interpolate(frame, [36, 56], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity: sceneIn,
      }}
    >
      <Img
        src={staticFile('logo-light.svg')}
        style={{
          width: 560,
          height: 'auto',
          transform: `scale(${logoScale})`,
          opacity: logoOpacity,
        }}
      />

      <div
        style={{
          marginTop: 32,
          fontFamily: 'JetBrains Mono',
          fontSize: 40,
          color: theme.solGreen,
          opacity: urlOpacity,
          transform: `translateY(${urlY}px)`,
          letterSpacing: 3,
          textShadow: `0 0 24px ${theme.solGreenSoft}`,
        }}
      >
        meetcivitas.xyz
      </div>

      <div
        style={{
          marginTop: 28,
          fontFamily: 'Inter',
          fontSize: 28,
          fontStyle: 'italic',
          color: theme.whiteDim,
          opacity: signOpacity,
          letterSpacing: 0.5,
        }}
      >
        private by construction.
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 70,
          opacity: partnerOpacity,
          fontFamily: 'JetBrains Mono',
          fontSize: 20,
          color: theme.whiteFaint,
          letterSpacing: 5,
          display: 'flex',
          gap: 28,
          textTransform: 'uppercase',
        }}
      >
        <span>solana</span>
        <span>·</span>
        <span>magicblock</span>
        <span>·</span>
        <span>nillion</span>
      </div>
    </AbsoluteFill>
  );
};
