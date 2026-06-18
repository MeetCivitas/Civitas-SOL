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

export const Pivot: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sceneIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const sceneOut = interpolate(frame, [80, 90], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const logoScale = spring({
    frame: frame - 4,
    fps,
    config: { damping: 200, mass: 0.5 },
    durationInFrames: 28,
  });
  const logoOpacity = interpolate(frame, [4, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const tagOpacity = interpolate(frame, [28, 52], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const tagY = interpolate(frame, [28, 52], [14, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const underline = interpolate(frame, [38, 64], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity: sceneIn * sceneOut,
      }}
    >
      <Img
        src={staticFile('logo-light.svg')}
        style={{
          width: 820,
          height: 'auto',
          transform: `scale(${logoScale})`,
          opacity: logoOpacity,
        }}
      />
      <div
        style={{
          marginTop: 36,
          fontFamily: 'JetBrains Mono',
          fontSize: 30,
          color: theme.whiteDim,
          opacity: tagOpacity,
          transform: `translateY(${tagY}px)`,
          letterSpacing: 3,
          textTransform: 'uppercase',
        }}
      >
        private payroll · live on devnet
      </div>
      <div
        style={{
          marginTop: 20,
          width: 380,
          height: 3,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            width: `${underline * 100}%`,
            height: '100%',
            transform: 'translateX(-50%)',
            background: theme.solGreen,
            boxShadow: `0 0 14px ${theme.solGreen}`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
