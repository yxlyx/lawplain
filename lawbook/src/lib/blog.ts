import { absoluteUrl } from "@/lib/seo";

export const BLOG_POSTS = [
  {
    slug: "how-lawplain-researches-singapore-law",
    title: "From question to sources.",
    seoTitle: "How Lawplain uses AI agents for Singapore legal research",
    subtitle:
      "How we use Graff to turn a question into research you can follow.",
    description:
      "Inside Lawplain’s Singapore legal research workflow: the Graff agent harness, source retrieval, and lessons from our sglaw experiments.",
    date: "2026-09-10",
    dateLabel: "10 September 2026",
    category: "Engineering",
    author: "Lawplain team",
    image: "/images/blog/research-harness.png",
    introduction:
      "A useful legal answer should give you somewhere to go next: a judgment to read, a provision to check, a source behind the explanation. That is the idea behind Lawplain. The interesting engineering happens between the question and those sources.",
    sections: [
      {
        id: "a-research-workflow",
        title: "A research workflow, in plain sight",
        body: `Lawplain brings Singapore judgments, legislation and parliamentary records into a searchable collection. You can search it yourself, or ask a question in plain English and let the research agent work through the materials.

The agent has to make several decisions. What kind of source is relevant? Which search terms are useful? Does a result actually address the question? Is there enough evidence to explain the point, or is there a gap that should remain visible?

Those decisions form a loop: search, inspect the returned material, read more where needed, then explain what the sources support. A search result helps locate evidence. The source text gives the reader something to check.

The diagram below is a simplified view of that workflow. A real question may need fewer steps, another search, or an answer that acknowledges the collection does not settle the point.`,
        diagram: "research",
      },
      {
        id: "why-a-harness",
        title: "What Graff brings to the work",
        body: `We use [Graff, from Codegraff](https://codegraff.com/), as the agent harness behind Lawplain’s research experience. A harness is the software around a model that lets it use tools, receive their results and continue working. Graff was built for coding agents; that ability to work through a task also makes it useful for research.

The model supplies language understanding and reasoning. The harness handles the working loop. Lawplain supplies the Singapore legal collection, the research tools and the product experience around the answer.

This gives us a capable starting point out of the box. We can connect a modern agent runtime to a specialised research environment instead of rebuilding the execution loop for every model. The domain work still matters: the quality of the collection, the shape of the tool responses and the instructions for using evidence all affect the result.

In Lawplain, Graff runs in an isolated research environment and queries read-only corpus endpoints. The interface translates its activity into visible searching and reading steps. The output is an explanation with links back to the materials, so the reader can continue the research.

That is the useful part of a modern harness here: it makes a capable model operational. It does not, by itself, establish that a legal conclusion is correct.`,
      },
      {
        id: "the-source-layer",
        title: "The source layer does real work",
        body: `Legal research is sensitive to small differences in wording. A case name, a section number or the way an amount is written can decide whether a search finds the right passage. This is why retrieval is a substantial part of the system.

The work began in our **sglaw** project, which brings public Singapore legal materials into a structured, searchable corpus. That gives the agent identifiable documents and passages to work with, rather than an undifferentiated collection of text.

Different materials also serve different purposes. A judgment, an Act and a parliamentary speech should retain their source identity when they appear in a research answer. Keeping identifiers and source links alongside the text makes that distinction easier to preserve.

For the reader, the principle is straightforward: follow the citation, read the relevant text and check the linked official source for its current or authoritative version. The collection is a research aid with coverage limits. A missing result is a limit of the search or collection, not proof that an authority does not exist.`,
      },
      {
        id: "lessons-from-sglaw",
        title: "Three lessons from the sglaw experiments",
        body: `Before and alongside the product, we have used sglaw to experiment with retrieval, research instructions and evaluation. These were bounded engineering experiments. They are useful for finding defects and comparing approaches, but they do not establish a general legal-accuracy score for Lawplain.

### 01 / A real citation is only the first check

Early evaluations checked whether cited cases existed in the corpus and whether the answer found a small expected list of authorities. That exposed a limitation in the evaluation itself: an answer could cite a relevant alternative authority and still miss the expected list.

We extended the evaluation to recognise alternative authorities for a legal issue. Even that remains a proxy. A citation can be real and relevant while the explanation misreads it. Source existence, issue coverage and the quality of the legal explanation are separate questions.

### 02 / Small retrieval details can block good research

Another set of experiments looked at provision searches across different phrasings, including numbers written as digits or words. Equivalent information needs did not always retrieve the same provision. We compared retrieval variations against a fixed set of provision targets and checked the labels against the underlying text.

The lesson was practical: investigate the path to the evidence before assuming the model needs more reasoning. These tests measured retrieval on a limited selection of Acts. Better retrieval in that setting is useful evidence for an engineering change; it is not a measurement of end-to-end answer quality.

### 03 / More activity is not always better research

We also tried changes to research instructions and tool descriptions, comparing issue coverage with the cost and length of runs. Some changes helped; others added work or made coverage worse. The experiments included a reason to leave a working configuration alone when there was no demonstrated gap to fix.

That informs how we think about the product: a useful run should make progress towards evidence. Repeating searches is not, on its own, a sign of thoroughness. The live system uses bounded research runs; the experimental tuning work should not be read as a claim that it autonomously rewrites itself for every user.`,
        diagram: "experiments",
      },
      {
        id: "one-collection-two-ways",
        title: "One collection, two ways to work",
        body: `The website is one way into the collection. Lawplain’s [MCP server](/developers/mcp) makes search and reading tools available to compatible agents, so the same research materials can be used inside an existing workflow.

The roles are different. **Ask Lawplain** runs our research experience with Graff. **MCP** gives your agent access to Lawplain’s corpus tools; your chosen client runs its own agent loop. You do not need to run Graff to use Lawplain through MCP.

MCP access requires an approved account and an enabled personal API key. The [setup guide](/developers/mcp) includes client configurations and a plain-text version for agents. For readers who simply want to look something up, [searching the collection](/) is the direct route.`,
      },
      {
        id: "research-you-can-follow",
        title: "Research you can follow",
        body: `Our aim is to make Singapore legal materials easier to find and work through. The model, harness and retrieval layer each contribute, but the reader should be able to see the result in concrete terms: what was found, what it supports and what still needs checking.

We will use this blog to share more of the engineering and the lessons from building Lawplain: how we evaluate research, what makes sources easier to use, and what we learn from the questions people bring to the product.

[Try a question in Ask Lawplain](/ask), [browse the source collections](/research), or [connect your agent](/developers/mcp).`,
      },
    ],
  },
] as const;

export type BlogPost = (typeof BLOG_POSTS)[number];

export function blogPath(post: BlogPost) {
  return `/blog/${post.slug}`;
}

export function blogMarkdown(post: BlogPost) {
  const diagramText: Record<string, string> = {
    research:
      "Diagram: A question enters Lawplain. Graff runs the model-and-tool loop: search → inspect → read → explain. Search and reading use the Singapore legal collection; the result is an explanation with source links. Steps may repeat within a bounded run.",
    experiments:
      "Diagram: Run a fixed research task → check sources and issue coverage → compare coverage, cost and length → keep an evidenced improvement or leave the baseline unchanged. Repeat in the experimental environment; this is not a live per-user self-tuning loop.",
  };
  return `# ${post.title}\n\n${post.subtitle}\n\nBy ${post.author} · ${post.dateLabel}\n\nSource: ${absoluteUrl(blogPath(post))}\n\n${post.introduction}\n\n${post.sections.map((section) => `## ${section.title}\n\n${section.body}${"diagram" in section ? `\n\n${diagramText[section.diagram]}` : ""}`).join("\n\n")}\n\nLegal information, not legal advice.\n`;
}

export function blogReadingMinutes(post: BlogPost) {
  return Math.ceil(blogMarkdown(post).split(/\s+/).length / 220);
}

export function blogArticleJsonLd(post: BlogPost) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    alternativeHeadline: post.seoTitle,
    description: post.description,
    url: absoluteUrl(blogPath(post)),
    mainEntityOfPage: absoluteUrl(blogPath(post)),
    image: absoluteUrl(post.image),
    datePublished: `${post.date}T00:00:00+08:00`,
    dateModified: `${post.date}T00:00:00+08:00`,
    author: {
      "@type": "Organization",
      name: post.author,
      url: absoluteUrl("/blog"),
    },
    publisher: {
      "@type": "Organization",
      name: "Lawplain",
      url: absoluteUrl("/"),
    },
    articleSection: post.category,
    inLanguage: "en-SG",
    isAccessibleForFree: true,
  };
}
