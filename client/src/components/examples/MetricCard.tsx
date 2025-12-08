import MetricCard from '../MetricCard';
import { Zap, Clock, RefreshCw, CheckCircle } from 'lucide-react';

export default function MetricCardExample() {
  return (
    <div className="grid grid-cols-2 gap-3 max-w-md">
      <MetricCard 
        label="Avg Attempts" 
        value="2.3" 
        subValue="per scene"
        trend="down"
        trendValue="-15% from last run"
        icon={<RefreshCw className="w-5 h-5" />}
      />
      <MetricCard 
        label="Quality Score" 
        value="87%" 
        trend="up"
        trendValue="+5% improvement"
        icon={<CheckCircle className="w-5 h-5" />}
      />
      <MetricCard 
        label="Generation Time" 
        value="4.2m" 
        subValue="avg per scene"
        icon={<Clock className="w-5 h-5" />}
      />
      <MetricCard 
        label="Rules Added" 
        value="3" 
        subValue="new this session"
        icon={<Zap className="w-5 h-5" />}
      />
    </div>
  );
}
