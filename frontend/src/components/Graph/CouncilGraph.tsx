import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Position,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import { useCouncilStore, DomainName, ExpertResult } from "../../stores/councilStore";
import ExpertNodeComponent from "./ExpertNode";

const DOMAIN_COLORS: Record<string, string> = {
  legal: "#7B68EE",
  finance: "#2ECC71",
  medical: "#E74C3C",
  technology: "#3498DB",
  education: "#F39C12",
  science: "#1ABC9C",
  business: "#9B59B6",
  ethics: "#E67E22",
  psychology: "#E91E63",
  sociology: "#00BCD4",
};

const nodeTypes = {
  expertNode: ExpertNodeComponent,
};

export default function CouncilGraphCanvas() {
  const selectedDomains = useCouncilStore((s) => s.selectedDomains);
  const experts = useCouncilStore((s) => s.experts);
  const contradictions = useCouncilStore((s) => s.contradictions);
  const agreements = useCouncilStore((s) => s.agreements);
  const status = useCouncilStore((s) => s.status);
  const currentNode = useCouncilStore((s) => s.currentNode);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useMemo(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    const distributorX = 0;
    const expertY = 150;
    const crossCheckX = 0;
    const crossCheckY = 350;
    const synthesisX = 0;
    const synthesisY = 500;

    newNodes.push({
      id: "distributor",
      type: "default",
      position: { x: distributorX - 80, y: 50 },
      data: {
        label: "Distributor",
        description: selectedDomains.length
          ? selectedDomains.join(", ")
          : "Analyzing...",
        color: "#4A90D9",
        isActive: currentNode === "distributor" || status === "processing",
      },
      style: {
        background: currentNode === "distributor"
          ? "rgba(74, 144, 217, 0.2)"
          : "rgba(74, 144, 217, 0.1)",
        border: `2px solid ${currentNode === "distributor" ? "#4A90D9" : "rgba(74, 144, 217, 0.4)"}`,
        borderRadius: 12,
        padding: "12px 20px",
        color: "#fff",
        fontSize: 14,
        fontWeight: 600,
        minWidth: 180,
        textAlign: "center",
      },
    });

    const domainPositions: Record<string, number> = {};
    const domainCount = selectedDomains.length || 1;
    selectedDomains.forEach((domain, i) => {
      const x = (i - (domainCount - 1) / 2) * 220;
      domainPositions[domain] = x;
      const expert = experts.find((e) => e.domain === domain) as ExpertResult | undefined;

      newNodes.push({
        id: `expert-${domain}`,
        type: "expertNode",
        position: { x: x - 75, y: expertY },
        data: {
          domain,
          label: domain.charAt(0).toUpperCase() + domain.slice(1),
          analysis: expert?.analysis,
          confidence: expert?.confidence,
          color: DOMAIN_COLORS[domain] || "#6B7280",
          isActive: currentNode === "experts" && !expert,
          isComplete: !!expert,
        },
      });
    });

    const crossCheckHasData = contradictions.length > 0 || agreements.length > 0;
    newNodes.push({
      id: "crosscheck",
      type: "default",
      position: { x: crossCheckX - 80, y: crossCheckY },
      data: {
        label: "Cross-Check",
        description: crossCheckHasData
          ? `${contradictions.length} contradictions, ${agreements.length} agreements`
          : "Analyzing...",
        color: "#F39C12",
        isActive: currentNode === "cross_check",
      },
      style: {
        background: currentNode === "cross_check"
          ? "rgba(243, 156, 18, 0.2)"
          : "rgba(243, 156, 18, 0.1)",
        border: `2px solid ${currentNode === "cross_check" ? "#F39C12" : "rgba(243, 156, 18, 0.4)"}`,
        borderRadius: 12,
        padding: "12px 20px",
        color: "#fff",
        fontSize: 14,
        fontWeight: 600,
        minWidth: 180,
        textAlign: "center",
      },
    });

    const synthesisData = useCouncilStore.getState().synthesis;
    newNodes.push({
      id: "synthesizer",
      type: "default",
      position: { x: synthesisX - 80, y: synthesisY },
      data: {
        label: "Synthesizer",
        description: synthesisData?.verdict
          ? synthesisData.verdict.slice(0, 60) + (synthesisData.verdict.length > 60 ? "..." : "")
          : "Waiting...",
        color: "#1ABC9C",
        isActive: currentNode === "synthesizer",
      },
      style: {
        background: currentNode === "synthesizer"
          ? "rgba(26, 188, 156, 0.2)"
          : "rgba(26, 188, 156, 0.1)",
        border: `2px solid ${currentNode === "synthesizer" ? "#1ABC9C" : "rgba(26, 188, 156, 0.4)"}`,
        borderRadius: 12,
        padding: "12px 20px",
        color: "#fff",
        fontSize: 14,
        fontWeight: 600,
        minWidth: 180,
        textAlign: "center",
      },
    });

    selectedDomains.forEach((domain) => {
      const x = domainPositions[domain];
      newEdges.push({
        id: `edge-dist-${domain}`,
        source: "distributor",
        target: `expert-${domain}`,
        animated: currentNode === "experts" || currentNode === "distributor",
        style: {
          stroke: DOMAIN_COLORS[domain] || "#6B7280",
          strokeWidth: 2,
        },
      });

      newEdges.push({
        id: `edge-${domain}-cross`,
        source: `expert-${domain}`,
        target: "crosscheck",
        animated: currentNode === "cross_check",
        style: {
          stroke: "#F39C12",
          strokeWidth: 2,
          opacity: 0.6,
        },
      });
    });

    newEdges.push({
      id: "edge-cross-synth",
      source: "crosscheck",
      target: "synthesizer",
      animated: currentNode === "synthesizer",
      style: {
        stroke: "#1ABC9C",
        strokeWidth: 2,
      },
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [selectedDomains, experts, contradictions, agreements, status, currentNode, setNodes, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.3}
      maxZoom={2}
      defaultEdgeOptions={{
        type: "smoothstep",
        style: { strokeWidth: 2 },
      }}
    >
      <Background color="#1f2937" gap={20} />
      <Controls
        style={{
          background: "#1f2937",
          border: "1px solid #374151",
          borderRadius: 8,
          button: { color: "#fff", border: "none" },
        }}
      />
      <MiniMap
        style={{
          background: "#111827",
          border: "1px solid #374151",
          borderRadius: 8,
        }}
        nodeColor={(n) => n.data?.color || "#6B7280"}
        maskColor="rgba(0,0,0,0.6)"
      />
    </ReactFlow>
  );
}
