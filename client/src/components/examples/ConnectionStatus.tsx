import ConnectionStatus from '../ConnectionStatus';

export default function ConnectionStatusExample() {
  return (
    <div className="flex items-center gap-6">
      <ConnectionStatus connected={true} />
      <ConnectionStatus connected={false} />
    </div>
  );
}
