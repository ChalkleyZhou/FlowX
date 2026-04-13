import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';

interface DiffFileItem {
  key: string;
  path: string;
  kind: 'modified' | 'untracked';
}

interface DiffFileListPanelProps {
  count: number;
  files: DiffFileItem[];
  activeKey?: string | null;
  onSelect: (key: string) => void;
}

interface FileLeafNode {
  type: 'file';
  key: string;
  name: string;
  fullPath: string;
  kind: 'modified' | 'untracked';
}

interface DirectoryNode {
  type: 'directory';
  name: string;
  fullPath: string;
  children: Array<DirectoryNode | FileLeafNode>;
}

function sortNodes(nodes: Array<DirectoryNode | FileLeafNode>) {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }

    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

function buildFileTree(files: DiffFileItem[]): Array<DirectoryNode | FileLeafNode> {
  const root: Array<DirectoryNode | FileLeafNode> = [];

  function insertNode(
    children: Array<DirectoryNode | FileLeafNode>,
    segments: string[],
    file: DiffFileItem,
    currentPath = '',
  ) {
    const [segment, ...rest] = segments;
    if (!segment) {
      return;
    }

    const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
    const isFile = rest.length === 0;

    if (isFile) {
      children.push({
        type: 'file',
        key: file.key,
        name: segment,
        fullPath: file.path.replace(/\\/g, '/'),
        kind: file.kind,
      });
      return;
    }

    let directory = children.find(
      (child): child is DirectoryNode => child.type === 'directory' && child.name === segment,
    );

    if (!directory) {
      directory = {
        type: 'directory',
        name: segment,
        fullPath: nextPath,
        children: [],
      };
      children.push(directory);
    }

    insertNode(directory.children, rest, file, nextPath);
  }

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, '/');
    const segments = normalizedPath.split('/').filter(Boolean);

    if (segments.length === 0) {
      continue;
    }

    insertNode(root, segments, file);
  }

  function normalizeChildren(children: Array<DirectoryNode | FileLeafNode>): Array<DirectoryNode | FileLeafNode> {
    return sortNodes(
      children.map((child) =>
        child.type === 'directory'
          ? {
              ...child,
              children: normalizeChildren(child.children),
            }
          : child,
      ),
    );
  }

  return normalizeChildren(root);
}

function TreeFileRow({
  file,
  activeKey,
  depth,
  onSelect,
}: {
  file: FileLeafNode;
  activeKey?: string | null;
  depth: number;
  onSelect: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center justify-between gap-4 rounded-md border-l-2 border-transparent px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'hover:bg-muted',
        file.key === activeKey && 'border-l-blue-500 bg-blue-50/70 text-foreground',
      )}
      style={{ paddingLeft: `${12 + depth * 18}px` }}
      onClick={() => onSelect(file.key)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 whitespace-nowrap text-sm font-medium text-foreground">{file.name}</div>
      </div>
      <Badge variant={file.kind === 'untracked' ? 'warning' : 'outline'} className="shrink-0 rounded-md px-2 py-0.5 text-xs">
        {file.kind === 'untracked' ? '未跟踪' : '已修改'}
      </Badge>
    </button>
  );
}

function TreeDirectory({
  node,
  activeKey,
  depth,
  onSelect,
}: {
  node: DirectoryNode;
  activeKey?: string | null;
  depth: number;
  onSelect: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const hasActiveDescendant = useMemo(() => {
    function walk(children: Array<DirectoryNode | FileLeafNode>): boolean {
      return children.some((child) => {
        if (child.type === 'file') {
          return child.key === activeKey;
        }

        return walk(child.children);
      });
    }

    return walk(node.children);
  }, [activeKey, node.children]);

  const isExpanded = expanded || hasActiveDescendant;

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs font-semibold tracking-[0.02em] text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
        {isExpanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
        <span className="whitespace-nowrap">{node.name}</span>
      </button>
      {isExpanded ? (
        <div className="space-y-1">
          {node.children.map((child) =>
            child.type === 'directory' ? (
              <TreeDirectory
                key={child.fullPath}
                node={child}
                activeKey={activeKey}
                depth={depth + 1}
                onSelect={onSelect}
              />
            ) : (
              <TreeFileRow
                key={child.key}
                file={child}
                activeKey={activeKey}
                depth={depth + 1}
                onSelect={onSelect}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function DiffFileListPanel({
  count,
  files,
  activeKey,
  onSelect,
}: DiffFileListPanelProps) {
  const treeRoots = buildFileTree(files);

  return (
    <Card className="rounded-2xl border-border bg-card shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-0">
        <CardTitle className="text-sm">变更文件</CardTitle>
        <span className="text-sm leading-6 text-muted-foreground">{count} 个文件</span>
      </CardHeader>
      <CardContent className="p-4">
        <ScrollArea className="h-[28rem]">
          <div className="w-fit min-w-full whitespace-nowrap pr-3">
            <div className="space-y-1">
              {treeRoots.map((node) =>
                node.type === 'directory' ? (
                  <TreeDirectory
                    key={node.fullPath}
                    node={node}
                    activeKey={activeKey}
                    depth={0}
                    onSelect={onSelect}
                  />
                ) : (
                  <TreeFileRow
                    key={node.key}
                    file={node}
                    activeKey={activeKey}
                    depth={0}
                    onSelect={onSelect}
                  />
                ),
              )}
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
