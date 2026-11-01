import { IconChevronRight, IconDotsFill } from "@pond/icons";
import type { SavedView } from "@pond/schema/db";
import { Button, cssVars, Menu, type MenuItemSpec, Sidebar } from "@pond/ui";
import { useId, useState } from "react";
import {
  groupMoveChoices,
  selectedViewRoots,
} from "@/features/library/lib/smart-folders";
import { savedViews } from "@/features/library/state/saved-views";
import { InlineNameEditor } from "@/shared/components/inline-name-editor";
import {
  SpecContextMenu,
  SpecMenu,
} from "@/shared/components/spec-context-menu";
import { FolderIcon, folderColorCss } from "@/shared/lib/folder-icons";
import type { useOrganizationTree } from "../../../hooks/use-organization-tree";
import { ENTRY_TYPES, entryItems, runAction } from "../menu-items";
import { selectionItems } from "../selection-items";
import type { OpenEditor, SavedViewPresentation } from "../types";
import styles from "./styles.module.css";

interface EntryProps {
  organization: ReturnType<typeof useOrganizationTree>;
  view: SavedView;
  views: SavedView[];
  childrenByParent: Map<string | null, SavedView[]>;
  activeId: string | null;
  onSelect: () => void;
  depth: number;
  editingViewId: string | null;
  onFinishRenaming: () => void;
  onStartRenaming: (id: string) => void;
  openEditor: OpenEditor;
  presentations: Record<string, SavedViewPresentation>;
  quickAccessIds: string[];
}

export function SmartFolderEntry({
  organization,
  view,
  views,
  childrenByParent,
  activeId,
  onSelect,
  depth,
  editingViewId,
  onFinishRenaming,
  onStartRenaming,
  openEditor,
  presentations,
  quickAccessIds,
}: EntryProps) {
  const [open, setOpen] = useState(true);
  const childrenId = useId();
  const active = activeId === view.id;
  const isGroup = view.kind === "group";
  const renaming = editingViewId === view.id;
  const children = childrenByParent.get(view.id) ?? [];
  const { label, icon: Icon } = ENTRY_TYPES[view.kind];
  const presentation = presentations[view.id] ?? {};
  const color = folderColorCss(presentation.color);
  const select = () => {
    savedViews.select(view.id);
    onSelect();
  };
  const selectedCount = views.filter((entry) =>
    organization.selected.includes(entry.id),
  ).length;
  const items = (): MenuItemSpec[] =>
    selectedCount > 1 && organization.selected.includes(view.id)
      ? selectionItems(organization.selected, views)
      : entryItems({
          view,
          views,
          active,
          onSelect: select,
          openEditor,
          onRename: () => onStartRenaming(view.id),
          onStartRenaming,
          onCreated: () => {
            setOpen(true);
            onSelect();
          },
          presentation,
          quickAccessIds,
        });

  return (
    <Sidebar.CollapsibleGroup
      className={styles.branch}
      open={open}
      onOpenChange={setOpen}
    >
      <SpecContextMenu
        search
        searchLabel="Search Smart Folder operations"
        buildItems={items}
      >
        <div className={styles.row} style={cssVars({ "--entry-depth": depth })}>
          {isGroup ? (
            <Button
              icon
              size="xs"
              variant="bare"
              className={styles.disclosure}
              aria-label={`${open ? "Collapse" : "Expand"} ${view.name}`}
              aria-expanded={open}
              aria-controls={childrenId}
              tabIndex={-1}
              onClick={(event) => {
                setOpen((value) => !value);
                event.currentTarget.parentElement
                  ?.querySelector<HTMLElement>('[role="treeitem"]')
                  ?.focus();
              }}
            >
              <IconChevronRight size={12} strokeWidth={2} />
            </Button>
          ) : null}
          {renaming ? (
            <div className={styles.editor}>
              <Sidebar.Icon className={styles.icon}>
                <span style={color ? { color } : undefined}>
                  {presentation.icon ? (
                    <FolderIcon name={presentation.icon} />
                  ) : (
                    <Icon />
                  )}
                </span>
              </Sidebar.Icon>
              <InlineNameEditor
                name={view.name}
                className={styles.field}
                ariaLabel={`${label} name`}
                onSave={(name) => savedViews.rename(view.id, name)}
                onFinish={onFinishRenaming}
              />
            </div>
          ) : (
            <Sidebar.Item
              className={styles.item}
              data-status={
                active || organization.selected.includes(view.id)
                  ? "active"
                  : undefined
              }
              aria-current={active ? "page" : undefined}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  "application/x-pond-saved-views",
                  (organization.selected.includes(view.id)
                    ? organization.selected
                    : [view.id]
                  ).join("\n"),
                );
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (
                  isGroup &&
                  event.dataTransfer.types.includes(
                    "application/x-pond-saved-views",
                  )
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                if (!isGroup) return;
                const ids = event.dataTransfer
                  .getData("application/x-pond-saved-views")
                  .split("\n")
                  .filter(Boolean);
                if (!ids.length) return;
                event.preventDefault();
                event.stopPropagation();
                const roots = selectedViewRoots(ids, views);
                if (
                  !roots.every((entry) =>
                    groupMoveChoices(entry.id, views).some(
                      (group) => group.id === view.id,
                    ),
                  )
                )
                  return;
                void runAction(async () => {
                  for (const entry of roots)
                    await savedViews.move(entry.id, view.id);
                  setOpen(true);
                });
              }}
              {...organization.rowProps(
                view.id,
                depth,
                isGroup ? open : undefined,
                () => setOpen((value) => !value),
              )}
            >
              <Sidebar.Icon>
                <span style={color ? { color } : undefined}>
                  {presentation.icon ? (
                    <FolderIcon name={presentation.icon} />
                  ) : (
                    <Icon />
                  )}
                </span>
              </Sidebar.Icon>
              <Sidebar.ItemLabel>{view.name}</Sidebar.ItemLabel>
            </Sidebar.Item>
          )}
          {renaming ? null : (
            <SpecMenu
              search
              searchLabel="Search Smart Folder operations"
              align="end"
              buildItems={items}
            >
              <Menu.Trigger
                icon
                size="xs"
                variant="text"
                className={styles.more}
                aria-label={`More Actions for ${view.name}`}
                tabIndex={-1}
              >
                <IconDotsFill size={12} />
              </Menu.Trigger>
            </SpecMenu>
          )}
        </div>
      </SpecContextMenu>
      {isGroup ? (
        <Sidebar.CollapsibleGroupContent
          id={childrenId}
          inert={!open}
          aria-hidden={!open}
        >
          {children.map((child) => (
            <SmartFolderEntry
              organization={organization}
              key={child.id}
              view={child}
              views={views}
              childrenByParent={childrenByParent}
              activeId={activeId}
              onSelect={onSelect}
              depth={depth + 1}
              editingViewId={editingViewId}
              onFinishRenaming={onFinishRenaming}
              onStartRenaming={onStartRenaming}
              openEditor={openEditor}
              presentations={presentations}
              quickAccessIds={quickAccessIds}
            />
          ))}
        </Sidebar.CollapsibleGroupContent>
      ) : null}
    </Sidebar.CollapsibleGroup>
  );
}
