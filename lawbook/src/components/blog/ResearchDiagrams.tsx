const RESEARCH_STEPS = [
  ["Search", "Find candidate sources"],
  ["Inspect", "Assess the material"],
  ["Read", "Examine relevant text"],
  ["Explain", "Connect claims to sources"],
];

export function ResearchDiagram({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`research-diagram ${compact ? "is-compact" : ""}`}>
      <div className="diagram-topline">
        <span>Question → research → sources</span>
        <span>01</span>
      </div>
      <div className="diagram-question">
        <span className="diagram-dot" />A question in plain English
      </div>
      <div className="diagram-connector" aria-hidden="true">
        ↓
      </div>
      <div className="diagram-harness">
        <div className="diagram-harness-label">
          <strong>Graff</strong>
          <span>The agent harness</span>
        </div>
        <ol className="diagram-steps">
          {RESEARCH_STEPS.map(([title, detail], i) => (
            <li key={title}>
              <span className="diagram-step-number">0{i + 1}</span>
              <strong>{title}</strong>
              <span>{detail}</span>
            </li>
          ))}
        </ol>
        <p className="diagram-loop">
          ↳ Follow the evidence. Continue where needed.
        </p>
      </div>
      <div className="diagram-exchange">
        <span aria-hidden="true">↕</span> Search & read tools
      </div>
      <div className="diagram-corpus">
        <strong>Singapore legal collection</strong>
        <span>Judgments · Legislation · Parliamentary records</span>
      </div>
      <div className="diagram-outcome">
        <span aria-hidden="true">↗</span>
        <strong>The result</strong>
        <span>An explanation with sources you can open.</span>
      </div>
      {!compact && (
        <figcaption>
          01 / A simplified view of Ask Lawplain. The harness runs the workflow;
          the collection provides the source material. Research is bounded and
          may leave questions unresolved.
        </figcaption>
      )}
    </figure>
  );
}

export function ExperimentDiagram() {
  const steps = [
    ["Run", "Use a fixed research task."],
    ["Check", "Sources and issue coverage."],
    ["Compare", "Coverage, cost and length."],
    ["Decide", "Keep a supported improvement—or keep the baseline."],
  ];
  return (
    <figure className="research-diagram experiment-diagram">
      <div className="diagram-topline">
        <span>Learning from a research run</span>
        <span>02</span>
      </div>
      <ol className="experiment-steps">
        {steps.map(([title, detail], i) => (
          <li key={title}>
            <span className="experiment-number">0{i + 1}</span>
            <div>
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="experiment-return">
        ↩ Repeat against the same evaluation tasks
      </div>
      <figcaption>
        02 / The sglaw experiment loop. A change has to earn its place. This
        describes development experiments, not automatic tuning of every live
        answer.
      </figcaption>
    </figure>
  );
}
