import PipelineHeader from '../PipelineHeader';

export default function PipelineHeaderExample() {
  return (
    <div className="w-full border rounded-md overflow-hidden">
      <PipelineHeader 
        title="Epic Fantasy Music Video"
        status="generating"
        connected={true}
        progress={{ current: 4, total: 12 }}
        isDark={false}
        onToggleTheme={() => console.log('Toggle theme')}
        onStart={() => console.log('Start')}
        onPause={() => console.log('Pause')}
        onReset={() => console.log('Reset')}
      />
    </div>
  );
}
