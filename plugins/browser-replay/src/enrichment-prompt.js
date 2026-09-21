export function artifactPaths({candidatePath,recordingPath,observationsPath}) {
  const entries = Object.entries({candidatePath,recordingPath,observationsPath});
  if (entries.some(([,value]) => /[\r\n\0]/.test(value))) throw new Error('Artifact paths must not contain line breaks or NUL characters');
  return 'File-tool paths (normalized absolute paths; the value is on the next line):\n'+entries.map(([key,value]) => `${key}:\n${value}`).join('\n\n')+
    '\nProvide exact unquoted string paths for file tool parameters such as AbsolutePath. Do not wrap path strings in extra double quotes, single quotes, or backticks. Preserve spaces and any characters inside the actual filename. Let the tool transport serialize the string once; do not JSON-stringify the path yourself. Use plain text for toolAction and toolSummary too. Shell quoting in the separate verification command is only for run_command, never for file-tool parameters. If a tool denies access, stop and report ACCESS_DENIED with the tool and path; do not attempt another tool or alternate path to bypass the denial.';
}
