import type { Mask } from '@photoy/types';
import { renderedSize, selectedLayer, useEditor } from '../store/editor';
import { placeDocument } from '../lib/viewport';

/**
 * Shows where the selected layer's mask applies.
 *
 * The dashed boundary is exact: it is drawn at the midpoint of the transition,
 * which is a number the mask already carries. The violet wash beside it is a
 * guide to which side is affected, not a rendering of the falloff - the engine
 * uses a smoothstep and this uses a linear ramp, and pretending otherwise would
 * be a picture that disagrees with the picture.
 */
export function MaskOverlay({
  container,
}: {
  container: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element | null {
  const layer = useEditor(selectedLayer);
  const cropping = useEditor((state) => state.cropRect !== null);
  const viewport = useEditor((state) => state.viewport);
  const documentWidth = useEditor((state) => renderedSize(state)?.width ?? 0);
  const documentHeight = useEditor((state) => renderedSize(state)?.height ?? 0);

  const mask: Mask | undefined = layer?.mask;
  if (cropping || mask === undefined || mask.kind === 'none' || documentWidth === 0) return null;

  const box = container.current?.getBoundingClientRect();
  if (box === undefined) return null;

  const placement = placeDocument(
    { width: box.width, height: box.height },
    { width: documentWidth, height: documentHeight },
    viewport.scale,
    viewport.offsetX,
    viewport.offsetY,
  );
  const frame = {
    left: placement.left,
    top: placement.top,
    width: documentWidth * placement.scale,
    height: documentHeight * placement.scale,
  };
  // Distances are in units of the shorter side, the same as the engine's.
  const unit = Math.min(frame.width, frame.height);

  const outline = 'rgba(196, 178, 253, 0.9)';
  const wash = 'rgba(167, 139, 250, 0.28)';

  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{ ...frame, position: 'absolute' }}
    >
      {mask.kind === 'linear' ? (
        <div
          className="absolute"
          style={{
            left: '-50%',
            top: '-50%',
            width: '200%',
            height: '200%',
            transform: `translate(${(mask.x - 0.5) * frame.width}px, ${(mask.y - 0.5) * frame.height}px) rotate(${-(mask.angle * 180) / Math.PI}deg)`,
            background: `linear-gradient(to bottom, transparent 0%, transparent calc(50% - ${(mask.feather * unit) / 2}px), ${wash} calc(50% + ${(mask.feather * unit) / 2}px), ${wash} 100%)`,
            borderTop: 'none',
          }}
        >
          <span
            className="absolute left-0 w-full"
            style={{ top: '50%', borderTop: `1px dashed ${outline}` }}
          />
        </div>
      ) : (
        <span
          className="absolute"
          style={{
            left: mask.x * frame.width,
            top: mask.y * frame.height,
            width: mask.radius * unit * 2,
            height: mask.radius * unit * 2,
            marginLeft: -mask.radius * unit,
            marginTop: -mask.radius * unit,
            borderRadius: '50%',
            border: `1px dashed ${outline}`,
            background: mask.invert ? 'transparent' : wash,
            boxShadow: mask.invert ? `0 0 0 9999px ${wash}` : 'none',
          }}
        />
      )}
    </div>
  );
}
