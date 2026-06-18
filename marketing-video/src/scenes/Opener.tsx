import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { theme } from '../theme';

export const Opener: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const numScale = spring({
    frame,
    fps,
    config: { damping: 8, mass: 0.7, stiffness: 110 },
  });
  const numOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const numColor = interpolateColors(
    frame,
    [70, 110],
    [theme.white, theme.red],
  );

  const numY = interpolate(frame, [80, 110], [0, -36], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const numFinalScale = interpolate(frame, [80, 110], [1, 0.86], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cap1Opacity = interpolate(
    frame,
    [30, 50, 85, 105],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const cap1Y = interpolate(frame, [30, 50], [16, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cap2Opacity = interpolate(
    frame,
    [110, 130, 170, 190],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const cap2Y = interpolate(frame, [110, 130], [18, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cap2Scale = interpolate(frame, [110, 135], [0.94, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cap3Opacity = interpolate(
    frame,
    [192, 212, 226, 240],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const cap3Y = interpolate(frame, [192, 212], [12, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const sceneOut = interpolate(frame, [230, 240], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity: sceneOut,
      }}
    >
      <div
        style={{
          fontFamily: 'Inter',
          fontSize: 340,
          fontWeight: 800,
          color: numColor,
          letterSpacing: -10,
          transform: `scale(${numScale * numFinalScale}) translateY(${numY}px)`,
          opacity: numOpacity,
          lineHeight: 1,
        }}
      >
        $650B
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: 24,
          height: 160,
          width: 1400,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: `translateX(-50%) translateY(${cap1Y}px)`,
            opacity: cap1Opacity,
            fontFamily: 'JetBrains Mono',
            fontSize: 40,
            color: theme.whiteDim,
            letterSpacing: 3,
            whiteSpace: 'nowrap',
            textTransform: 'uppercase',
          }}
        >
          solana stables · feb 2026
        </div>

        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: `translateX(-50%) translateY(${cap2Y}px) scale(${cap2Scale})`,
            opacity: cap2Opacity,
            fontFamily: 'Inter',
            fontSize: 96,
            fontWeight: 700,
            color: theme.red,
            letterSpacing: -2,
            whiteSpace: 'nowrap',
          }}
        >
          all public.
        </div>

        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: `translateX(-50%) translateY(${cap3Y}px)`,
            opacity: cap3Opacity,
            fontFamily: 'JetBrains Mono',
            fontSize: 32,
            color: theme.whiteDim,
            letterSpacing: 1.5,
            whiteSpace: 'nowrap',
          }}
        >
          token-2022 confidential transfers · offline since june
        </div>
      </div>
    </AbsoluteFill>
  );
};
