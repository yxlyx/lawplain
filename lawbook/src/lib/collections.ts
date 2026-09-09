export const COLLECTIONS = [
  {
    slug: "judgments",
    title: "Judgments",
    short: "The decisions that shape the law.",
    description:
      "Search Singapore case law, read court decisions, and follow the reasoning behind a judgment.",
    body: "Judgments explain how courts interpret legislation and apply legal principles to particular facts. Begin with a case name, a neutral citation, or a phrase describing the issue. Use court, year, and judge filters to narrow the results, then read the full decision in context.",
    tab: "judgments",
    query: "duty of care",
    tips: [
      "Search with a case name or neutral citation.",
      "Check the court and decision date before relying on a case.",
      "Read the relevant paragraphs and follow links to the official source.",
    ],
  },
  {
    slug: "statutes",
    title: "Statutes",
    short: "The written law, within reach.",
    description:
      "Find Singapore Acts and statutory provisions through full-text legislation search.",
    body: "Statutes set out Singapore’s written law. Search for a topic or the name of an Act to locate relevant provisions. The meaning of a section often depends on definitions, exceptions, and related provisions elsewhere in the Act. Check commencement status and the official text before relying on a provision.",
    tab: "statutes",
    query: "employment",
    tips: [
      "Start with an Act name or a specific legal term.",
      "Read definitions and exceptions alongside the relevant section.",
      "Confirm the current version and commencement on the official source.",
    ],
  },
  {
    slug: "hansard",
    title: "Parliament",
    short: "The conversations behind the law.",
    description:
      "Explore Singapore Hansard and parliamentary debates to research legislative background.",
    body: "Hansard records parliamentary proceedings, including speeches and debates about proposed legislation and public policy. It can help you understand the background to a law. Search by subject, then use speaker and date filters to focus your research. Parliamentary statements are distinct from enacted legislation.",
    tab: "hansard",
    query: "housing",
    tips: [
      "Search for the policy issue or name of a Bill.",
      "Use speaker and date filters to narrow a debate.",
      "Distinguish parliamentary discussion from the wording of enacted law.",
    ],
  },
  {
    slug: "guidance",
    title: "Agency guidance",
    short: "Practical context from official sources.",
    description:
      "Search official Singapore agency guidance, including PDPC and TAFEP materials.",
    body: "Agency guidance explains official approaches to issues such as personal data and workplace practices. It is not legislation. Search the topic, then check the issuing agency, document type, publication date, and official source to understand its status and scope.",
    tab: "guidance",
    query: "consent",
    tips: [
      "Filter by issuing agency or document type.",
      "Check whether a document is guidance, an advisory, or another publication.",
      "Read it alongside any applicable legislation and check for updates.",
    ],
  },
  {
    slug: "bills",
    title: "Bills",
    short: "Follow proposed changes to the law.",
    description: "Find Singapore Bills and research proposed legislation.",
    body: "Bills contain proposed legislation. A Bill’s text and status should be checked against the subsequent Act and its commencement provisions before treating it as current law. Search the title or policy topic, and use parliamentary debates to understand the proposal’s background.",
    tab: "bills",
    query: "data",
    tips: [
      "Search by title or policy topic.",
      "Check whether the Bill became an Act.",
      "Confirm commencement before treating a proposal as law.",
    ],
  },
  {
    slug: "subsidiary",
    title: "Subsidiary legislation",
    short: "The rules that put Acts into practice.",
    description:
      "Search Singapore regulations, rules, orders, and other subsidiary legislation.",
    body: "Subsidiary legislation contains detailed provisions made under powers granted by an Act. Search for the relevant rule or topic, then identify its parent Act. Read the instrument alongside that Act and check the official source for amendments and commencement.",
    tab: "subsidiary",
    query: "regulations",
    tips: [
      "Search for the instrument name or regulated activity.",
      "Identify the enabling Act.",
      "Check the official text for amendments and commencement.",
    ],
  },
  {
    slug: "practice",
    title: "Practice directions",
    short: "Navigate court procedure.",
    description:
      "Search Singapore practice directions and materials concerning court procedure.",
    body: "Practice directions provide procedural requirements and guidance for court work. Search by the step or process you are researching, such as filing or service. Check which court and edition a direction applies to, and read it together with the relevant rules of court.",
    tab: "practice",
    query: "filing",
    tips: [
      "Search for a procedural step or filing requirement.",
      "Check the applicable court and edition.",
      "Read alongside the relevant rules of court.",
    ],
  },
] as const;
