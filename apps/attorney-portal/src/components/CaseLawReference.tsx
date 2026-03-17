interface CaseLawReferenceProps {
  caseName: string;
  citation: string;
  year: number;
  court: string;
  holding: string;
}

export function CaseLawReference(props: CaseLawReferenceProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <p className="font-medium">{props.caseName}</p>
      <p className="text-sm text-gray-400 mt-1">
        {props.citation} | {props.court} ({props.year})
      </p>
      <p className="text-sm text-gray-300 mt-2">{props.holding}</p>
    </div>
  );
}
