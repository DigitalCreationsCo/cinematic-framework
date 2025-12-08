import FramePreview from '../FramePreview';

export default function FramePreviewExample() {
  return (
    <div className="grid grid-cols-2 gap-3 max-w-md">
      <FramePreview title="Start Frame" alt="Scene start frame" />
      <FramePreview title="End Frame" alt="Scene end frame" />
    </div>
  );
}
