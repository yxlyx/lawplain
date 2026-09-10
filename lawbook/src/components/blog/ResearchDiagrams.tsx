"use client";

import { useEffect, useId, useState } from "react";

type Box = [number, number, number, number];
type FlowNode = {
  label: string;
  lines: string[];
  detail: string;
  desktop: Box;
  mobile: Box;
};
type FlowEdge = { from: number; to: number; desktop: string; mobile: string };
type Flow = {
  number: string;
  title: string;
  caption: string;
  desktopHeight: number;
  mobileHeight: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

function sequenceFlow(
  number: string,
  title: string,
  caption: string,
  steps: [string, string, string][],
  loop = false,
): Flow {
  const desktop: Box[] = [
    [20, 24, 300, 100],
    [400, 24, 300, 100],
    [400, 208, 300, 100],
    [20, 208, 300, 100],
  ];
  return {
    number,
    title,
    caption,
    desktopHeight: 360,
    mobileHeight: loop ? 620 : 600,
    nodes: steps.map(([label, line, detail], i) => ({
      label,
      lines: [line],
      detail,
      desktop: desktop[i],
      mobile: [20, 20 + i * 145, 280, 100],
    })),
    edges: [
      { from: 0, to: 1, desktop: "M320 74 H400", mobile: "M160 120 V165" },
      { from: 1, to: 2, desktop: "M550 124 V208", mobile: "M160 265 V310" },
      { from: 2, to: 3, desktop: "M400 258 H320", mobile: "M160 410 V455" },
      ...(loop
        ? [
            {
              from: 3,
              to: 0,
              desktop: "M170 308 V342 H4 V4 H170 V24",
              mobile: "M160 555 V590 H5 V5 H160 V20",
            },
          ]
        : []),
    ],
  };
}

const RESEARCH = sequenceFlow(
  "01",
  "Question → research → sources",
  "01 / A simplified research loop inside Graff. Searches and reading use the Singapore legal collection. Steps may repeat within a bounded run; the answer links back to source material.",
  [
    [
      "Search",
      "Find candidate sources",
      "The question becomes a targeted search of the Singapore legal collection. Results identify documents to inspect.",
    ],
    [
      "Inspect",
      "Assess the returned material",
      "The agent considers whether a result addresses the question and which source text would be useful to read.",
    ],
    [
      "Read",
      "Examine the relevant text",
      "Read tools bring passages into the research context, keeping the document identity and source links attached.",
    ],
    [
      "Explain",
      "Connect claims to sources",
      "The agent writes an explanation grounded in the material found, with source links and any unresolved gaps.",
    ],
  ],
);

const EXPERIMENTS = sequenceFlow(
  "03",
  "Learning from a research run",
  "03 / The sglaw experiment loop. Changes are compared against fixed tasks. This describes development experiments, not automatic tuning of every live answer.",
  [
    [
      "Run",
      "Use a fixed research task",
      "Keep the information need consistent so candidate changes can be compared with the baseline.",
    ],
    [
      "Check",
      "Sources and issue coverage",
      "Check whether citations exist and whether the answer covers the expected legal issues. These are separate checks.",
    ],
    [
      "Compare",
      "Coverage, cost and length",
      "Look for a supported improvement in the outcome, alongside the cost and length of the research run.",
    ],
    [
      "Decide",
      "Improve—or keep the baseline",
      "Keep an evidenced improvement. If a change does not help, retain the baseline and test the next hypothesis.",
    ],
  ],
  true,
);

const SOURCES: Flow = {
  number: "02",
  title: "Different sources. Different roles.",
  desktopHeight: 360,
  mobileHeight: 575,
  caption:
    "02 / Three examples from the collection. Each contributes a different kind of material. Bringing them into one workflow does not make them interchangeable.",
  nodes: [
    {
      label: "Judgments",
      lines: ["The court’s reasoning"],
      detail:
        "Read the decision and the passages behind a proposition, preserving the case identity and citation.",
      desktop: [10, 24, 220, 100],
      mobile: [10, 20, 280, 100],
    },
    {
      label: "Legislation",
      lines: ["The operative text"],
      detail:
        "Read the provision, its qualifications and the source version. Keep the section reference attached to its text.",
      desktop: [250, 24, 220, 100],
      mobile: [10, 155, 280, 100],
    },
    {
      label: "Hansard",
      lines: ["Parliamentary debate"],
      detail:
        "Read what was said in Parliament with the speaker and date. Parliamentary debate retains its own source identity.",
      desktop: [490, 24, 220, 100],
      mobile: [10, 290, 280, 100],
    },
    {
      label: "A claim with its source",
      lines: ["Identity · Relevant text · Source link"],
      detail:
        "The reader can follow a claim back to the underlying material and consider it in context.",
      desktop: [180, 230, 360, 100],
      mobile: [10, 445, 280, 100],
    },
  ],
  edges: [
    {
      from: 0,
      to: 3,
      desktop: "M120 124 V176 Q120 190 134 190 H346 Q360 190 360 204 V230",
      mobile: "M290 70 H300 Q312 70 312 82 V483 Q312 495 300 495 H290",
    },
    {
      from: 1,
      to: 3,
      desktop: "M360 124 V230",
      mobile: "M290 205 H300 Q312 205 312 217 V483 Q312 495 300 495 H290",
    },
    {
      from: 2,
      to: 3,
      desktop: "M600 124 V176 Q600 190 586 190 H374 Q360 190 360 204 V230",
      mobile: "M290 340 H300 Q312 340 312 352 V483 Q312 495 300 495 H290",
    },
  ],
};

const ACCESS: Flow = {
  number: "04",
  title: "Two routes into the same collection",
  desktopHeight: 545,
  mobileHeight: 555,
  caption:
    "04 / Ask Lawplain uses Graff. An MCP client runs its own agent loop and accesses the same collection with approved access. Source material returns through the chosen route; MCP does not require Graff.",
  nodes: [
    {
      label: "Ask Lawplain",
      lines: ["On the website"],
      detail: "Ask a question in plain English through the Lawplain website.",
      desktop: [20, 20, 300, 90],
      mobile: [5, 20, 145, 100],
    },
    {
      label: "Your agent",
      lines: ["In your workflow"],
      detail:
        "Use a compatible agent client in the environment where you already work.",
      desktop: [400, 20, 300, 90],
      mobile: [170, 20, 145, 100],
    },
    {
      label: "Graff",
      lines: ["Lawplain’s research loop"],
      detail:
        "Graff runs the model-and-tool loop for the Ask Lawplain experience.",
      desktop: [20, 155, 300, 90],
      mobile: [5, 160, 145, 100],
    },
    {
      label: "Your runtime",
      lines: ["Your client’s agent loop"],
      detail:
        "Your selected client runs its own agent. Lawplain MCP supplies tools rather than replacing that runtime.",
      desktop: [400, 155, 300, 90],
      mobile: [170, 160, 145, 100],
    },
    {
      label: "Corpus tools",
      lines: ["Search and read via API"],
      detail:
        "Lawplain’s research agent queries read-only corpus endpoints to retrieve relevant material.",
      desktop: [20, 290, 300, 90],
      mobile: [5, 300, 145, 100],
    },
    {
      label: "Lawplain MCP",
      lines: ["Approved tool access"],
      detail:
        "An approved account and enabled personal API key give your client access to Lawplain’s MCP tools.",
      desktop: [400, 290, 300, 90],
      mobile: [170, 300, 145, 100],
    },
    {
      label: "Singapore legal collection",
      lines: ["The same underlying materials"],
      detail:
        "Both routes work with the Singapore legal collection. Each agent uses the returned material to form its answer.",
      desktop: [180, 440, 360, 90],
      mobile: [20, 455, 280, 90],
    },
  ],
  edges: [
    { from: 0, to: 2, desktop: "M170 110 V155", mobile: "M77.5 120 V160" },
    { from: 1, to: 3, desktop: "M550 110 V155", mobile: "M242.5 120 V160" },
    { from: 2, to: 4, desktop: "M170 245 V290", mobile: "M77.5 260 V300" },
    { from: 3, to: 5, desktop: "M550 245 V290", mobile: "M242.5 260 V300" },
    {
      from: 4,
      to: 6,
      desktop: "M170 380 V405 Q170 418 183 418 H347 Q360 418 360 431 V440",
      mobile: "M77.5 400 V417 Q77.5 430 90.5 430 H147 Q160 430 160 443 V455",
    },
    {
      from: 5,
      to: 6,
      desktop: "M550 380 V405 Q550 418 537 418 H373 Q360 418 360 431 V440",
      mobile: "M242.5 400 V417 Q242.5 430 229.5 430 H173 Q160 430 160 443 V455",
    },
  ],
};

function SvgFlow({ flow, compact = false }: { flow: Flow; compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(false);
  const [motionAllowed, setMotionAllowed] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionAllowed(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return (
    <figure
      className={`research-diagram svg-flow ${compact ? "is-compact" : ""} ${paused || !motionAllowed ? "is-paused" : ""}`}
    >
      <div className="diagram-topline">
        <span>{flow.title}</span>
        <span>{flow.number}</span>
      </div>
      <div className="flow-canvas">
        {(["desktop", "mobile"] as const).map((layout) => (
          <svg
            key={layout}
            className={`flow-svg flow-svg-${layout}`}
            viewBox={`0 0 ${layout === "desktop" ? 720 : 320} ${layout === "desktop" ? flow.desktopHeight : flow.mobileHeight}`}
            role={compact ? "img" : "group"}
            aria-label={flow.title}
          >
            <title>{flow.title}</title>
            <defs>
              <marker
                id={`${id}-${layout}-arrow`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M1 1 L9 5 L1 9" className="flow-arrowhead" />
              </marker>
            </defs>
            {flow.edges.map((edge, i) => (
              <g
                key={`${edge.from}-${edge.to}`}
                className={
                  edge.from === selected || edge.to === selected
                    ? "flow-edge is-highlighted"
                    : "flow-edge"
                }
              >
                <path
                  d={edge[layout]}
                  className="flow-track"
                  markerEnd={`url(#${id}-${layout}-arrow)`}
                />
                <path
                  d={edge[layout]}
                  className="flow-travel"
                  style={{ animationDelay: `${i * -0.55}s` }}
                />
              </g>
            ))}
            {flow.nodes.map((node, i) => {
              const [x, y, w, h] = node[layout];
              const content = (
                <>
                  <rect width={w} height={h} rx="7" />
                  <text x="14" y="21" className="flow-node-number">
                    0{i + 1}
                  </text>
                  <text
                    x={w / 2}
                    y={h / 2 + 1}
                    textAnchor="middle"
                    className="flow-node-label"
                  >
                    {node.label}
                  </text>
                  {node.lines.map((line, lineIndex) => (
                    <text
                      key={line}
                      x={w / 2}
                      y={h / 2 + 25 + lineIndex * 16}
                      textAnchor="middle"
                      className="flow-node-detail"
                    >
                      {line}
                    </text>
                  ))}
                </>
              );
              const nodeClass = `flow-node ${selected === i ? "is-selected" : ""} ${w < 180 ? "is-narrow" : ""}`;
              if (compact)
                return (
                  <g
                    key={node.label}
                    transform={`translate(${x} ${y})`}
                    className={nodeClass}
                  >
                    {content}
                  </g>
                );
              return (
                // biome-ignore lint/a11y/useSemanticElements: SVG groups cannot contain an HTML button; this node implements button semantics and keyboard activation.
                <g
                  key={node.label}
                  transform={`translate(${x} ${y})`}
                  className={nodeClass}
                  role="button"
                  tabIndex={0}
                  aria-label={`Explore ${node.label}`}
                  aria-pressed={selected === i}
                  onClick={() => setSelected(i)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(i);
                    }
                  }}
                >
                  {content}
                </g>
              );
            })}
          </svg>
        ))}
      </div>
      {!compact && (
        <>
          <div className="flow-toolbar">
            <span>Select a node to explore the flow.</span>
            <button
              type="button"
              disabled={!motionAllowed}
              onClick={() => setPaused((value) => !value)}
            >
              {!motionAllowed
                ? "Reduced motion"
                : paused
                  ? "Play flow"
                  : "Pause flow"}
            </button>
          </div>
          <div className="flow-explanation" aria-live="polite">
            <strong>{flow.nodes[selected].label}</strong>
            <p>{flow.nodes[selected].detail}</p>
          </div>
          <figcaption>
            {flow.caption} Motion illustrates direction, not live activity or
            measured speed.
          </figcaption>
        </>
      )}
    </figure>
  );
}

export function ResearchDiagram({ compact = false }: { compact?: boolean }) {
  return <SvgFlow flow={RESEARCH} compact={compact} />;
}
export function ExperimentDiagram() {
  return <SvgFlow flow={EXPERIMENTS} />;
}
export function SourceDiagram() {
  return <SvgFlow flow={SOURCES} />;
}
export function AccessDiagram() {
  return <SvgFlow flow={ACCESS} />;
}
