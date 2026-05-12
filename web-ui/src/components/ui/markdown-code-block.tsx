import type { ReactElement } from "react";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";

/**
 * Custom code block renderer for ReactMarkdown that renders mermaid
 * fenced code blocks as diagrams. Use as: components={{ code: MarkdownCodeBlock }}
 */
export function MarkdownCodeBlock({
	className,
	children,
	...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }): ReactElement {
	const match = /language-(\w+)/.exec(className || "");
	const lang = match?.[1];
	const code = String(children).replace(/\n$/, "");

	if (lang === "mermaid") {
		return <MermaidDiagram chart={code} />;
	}

	return (
		<code className={className} {...props}>
			{children}
		</code>
	);
}
