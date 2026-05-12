import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";

let initialized = false;

function ensureInit() {
	if (initialized) return;
	initialized = true;
	mermaid.initialize({
		startOnLoad: false,
		theme: "dark",
		themeVariables: {
			primaryColor: "#2a2e33",
			primaryTextColor: "#e0e0e0",
			primaryBorderColor: "#4a9eff",
			lineColor: "#4a9eff",
			secondaryColor: "#1a1d21",
			tertiaryColor: "#2a2e33",
		},
	});
}

let idCounter = 0;

export function MermaidDiagram({ chart }: { chart: string }): React.ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	const [svg, setSvg] = useState<string>("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		ensureInit();
		const id = `mermaid-${++idCounter}`;
		mermaid
			.render(id, chart)
			.then((result) => {
				setSvg(result.svg);
				setError(null);
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : "Failed to render diagram");
				setSvg("");
			});
	}, [chart]);

	if (error) {
		return (
			<pre className="rounded-md border border-status-red/30 bg-status-red/5 p-3 text-xs text-status-red overflow-x-auto">
				{error}
			</pre>
		);
	}

	return (
		<div
			ref={containerRef}
			className="my-4 flex justify-center overflow-x-auto"
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}
