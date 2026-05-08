export function KanbanIcon({ size = 20, className }: { size?: number; className?: string }): React.ReactElement {
	return (
		<svg width={size} height={size} viewBox="0 0 512 512" className={className}>
			<rect width="512" height="512" rx="96" fill="currentColor" opacity="0.15" />
			<rect x="80" y="120" width="100" height="280" rx="12" fill="currentColor" opacity="0.3" />
			<rect x="92" y="140" width="76" height="44" rx="8" fill="currentColor" />
			<rect x="92" y="196" width="76" height="44" rx="8" fill="currentColor" />
			<rect x="92" y="252" width="76" height="44" rx="8" fill="currentColor" />
			<rect x="206" y="120" width="100" height="280" rx="12" fill="currentColor" opacity="0.3" />
			<rect x="218" y="140" width="76" height="44" rx="8" fill="currentColor" />
			<rect x="218" y="196" width="76" height="44" rx="8" fill="currentColor" />
			<rect x="332" y="120" width="100" height="280" rx="12" fill="currentColor" opacity="0.3" />
			<rect x="344" y="140" width="76" height="44" rx="8" fill="currentColor" />
		</svg>
	);
}
