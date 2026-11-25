import { beamOutline } from './beam-body.js';
import { settleBuildingPlanQuestions } from './questions.js';
import { generateUuidV7 } from '../utilities/uuid.js';
import { createBuildingPlanSession } from './session.js';
import { getBuildingPlanFieldState } from './transactions.js';
import {
  readBuildingPlanRecord,
  writeBuildingPlanPreviewRecord,
  writeBuildingPlanRecord,
} from './records.js';
import { buildingPlanFaceSegments, copyBuildingPlanData as copy } from './model.js';
import {
  distance,
  dot,
  polygonArea,
  polygonEdges,
  project,
  roomBounds,
  segmentFrame,
} from './geometry.js';
import { normalizeBuildingPlanEditingPolicy } from './editing-policy.js';
import { faceExtent } from './face-extent.js';
import { createBuildingPlanInteraction } from './interaction.js';
import { buildingPlanFootprints, buildingPlanFaceAxes } from './footprints.js';
import { buildingPlanPlasterSurfaces, buildingPlanSidePlaster } from './plaster-surfaces.js';
import { buildingPlanRoomSides } from './room-sides.js';
import {
  freeWallBendCorners,
  freeWallCutPoints,
  freeWallSideDistance,
  newFreeWallFace,
  newFreeWallWidth,
  offsetLine,
} from './free-wall-lines.js';
import { buildingPlanCutPlacement, buildingPlanJoinPlacement } from './cut-placement.js';
import { buildingPlanFloorTitle } from './row-title.js';
import { buildingPlanFloorsByLevel } from './floor-order.js';
import { buildingPlanFloorBelow } from './floor-below.js';
import { buildingPlanProblems, problemRowPaths } from './plan-problems.js';

const COLORS = ['#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#ede9fe', '#cffafe'];
const label = (value, fallback) =>
  typeof value === 'string'
    ? value || fallback
    : value?.choice?.map((entry) => entry.label ?? entry.value).join(', ') ||
      value?.other?.map((entry) => entry.label ?? entry.value).join(', ') ||
      fallback;
const node = (meta, key) => meta.repeatablesByNodeKey[key];
const storage = (meta, key) =>
  node(meta, key).fields.find(
    (field) => field.binding?.role === 'storage' || field.binding?.storageRole === 'storage'
  ).dataName;
const subjectId = (meta, key, row) => JSON.parse(row.values[storage(meta, key)]).id;
const key = (meta, name) => node(meta, name).preferredKey;

// A managed host's canvas previews in this scope of its own session (`previewScopeId`).
const PREVIEW_SCOPE_ID = 'canvas-preview';

/** A portable, read-only rendering projection. Row paths retain the host's normal nesting. */
/**
 * A row's plaster (step 2, 2b), for the selected wall's name: its own side's and, where the face
 * across is this row's too (an outside face, a free wall's other side), that one's. Metres.
 */
function facePlaster(physical, face) {
  const own = (physical.sides || []).find((side) => side.id === face.sideId);
  const other = (physical.sides || []).find((side) => side !== own);
  const across = Boolean(other) && (other.roomId == null || other.roomId === own?.roomId);
  return {
    inside: buildingPlanSidePlaster(own),
    outside: across ? buildingPlanSidePlaster(other) : null,
    outsideFace: across,
  };
}

export function buildingPlanCanvasSnapshot({
  meta,
  record,
  plan,
  gridSize = 20,
  activeFloorIndex = 0,
  freeWallBends = false,
  floorBelow,
}) {
  const output = {
    floors: [],
    activeFloorIndex,
    rooms: [],
    walls: [],
    columns: [],
    beams: [],
    doors: [],
    windows: [],
    wallFootprints: [],
    physicalOpenings: [],
    editingCuts: [],
    corners: [],
    problems: [],
  };
  const pixels = (point) => ({ x: point.x * gridSize, y: point.y * gridSize });
  const floorRows = record.repeatable?.[key(meta, 'floors')] || [];
  // Where each floor stands in level order (its tab's place); the floors keep their own order.
  const levels = buildingPlanFloorsByLevel(plan.floors, (floor, name) => floor.values?.[name]);
  for (const [floorIndex, floor] of plan.floors.entries()) {
    const index = floorRows.findIndex((row) => subjectId(meta, 'floors', row) === floor.id);
    const floorRow = floorRows[index];
    const floorPath = [{ key: key(meta, 'floors'), index }];
    output.floors.push({
      id: floor.id,
      rowId: floorRow.id,
      index,
      label: buildingPlanFloorTitle((name) => floor.values[name]) || `F#${index + 1}`,
      order: levels.indexOf(floor),
      path: floorPath,
    });
    if (floorIndex !== activeFloorIndex) continue;
    Object.assign(output, buildingPlanFootprints(floor, gridSize));
    // Every visible wall face with its plaster (step 2, 2b): display only, previews included.
    output.plasterSurfaces = buildingPlanPlasterSurfaces(floor, {
      footprints: output.wallFootprints,
      openings: output.physicalOpenings,
      gridSize,
    });
    const roomRows = floorRow.repeatable[key(meta, 'rooms')] || [];
    for (const room of floor.rooms) {
      const cuts = new Set();
      const onCentreline = freeWallCutPoints(floor, room);
      for (const point of [
        ...room.vertices,
        ...room.faces.flatMap((face) => face.freePath || []),
      ]) {
        const marker = point.editingCutId || point.physicalBoundaryId;
        const edges = polygonEdges(room).filter(
          (edge) => edge.start.id === point.id || edge.end.id === point.id
        );
        const automatic =
          !point.editingCutId &&
          edges.length === 2 &&
          dot(edges[0].tangent, edges[1].tangent) > 1 - 1e-6 &&
          edges.every((edge) =>
            room.faces.some((face) => face.bindings.some((binding) => binding.edgeId === edge.id))
          );
        const token = `${marker}:${point.x}:${point.y}`;
        if (!marker || (!point.editingCutId && !automatic) || cuts.has(token)) continue;
        cuts.add(token);
        output.editingCuts.push({
          id: marker,
          automatic,
          roomId: room.id,
          point: pixels(onCentreline.get(point.id) || point),
        });
      }
      const roomIndex = roomRows.findIndex((row) => subjectId(meta, 'rooms', row) === room.id);
      const roomRow = roomRows[roomIndex];
      const roomPath = [...floorPath, { key: key(meta, 'rooms'), index: roomIndex }];
      output.corners.push(
        ...room.vertices
          .filter((point) => {
            if (point.editingCutId) return true;
            const edges = polygonEdges(room).filter(
              (edge) => edge.start.id === point.id || edge.end.id === point.id
            );
            const derived = edges.some(
              (edge) => room.edges.find((stored) => stored.id === edge.id)?.profile
            );
            return (
              !derived || edges.length !== 2 || dot(edges[0].tangent, edges[1].tangent) < 1 - 1e-6
            );
          })
          .map((point) => ({
            id: point.id,
            roomId: room.id,
            point: pixels(point),
          }))
      );
      // A free wall's split point bends it when dragged (4a-4, derived engine only).
      if (freeWallBends)
        output.corners.push(
          ...freeWallBendCorners(floor, room).map(({ point, cutId, faceIds, id }) => ({
            id,
            roomId: room.id,
            point: pixels(point),
            freeWall: { cutId, faceIds },
          }))
        );
      const bounds = roomBounds(room);
      output.rooms.push({
        id: room.id,
        rowId: roomRow.id,
        index: roomIndex,
        floorIndex,
        path: roomPath,
        vertices: room.vertices.map(pixels),
        rect: {
          x: bounds.x * gridSize,
          y: bounds.y * gridSize,
          width: bounds.width * gridSize,
          height: bounds.height * gridSize,
        },
        color: COLORS[roomIndex % COLORS.length],
        displayLabel: label(room.values.room_name, `R#${roomIndex + 1}`),
        // A new free wall's thickness here (metres), for snapping it while it is drawn (4a-3b).
        freeWallWidth: newFreeWallWidth(floor, room.id, meta.properties),
        // Its sides corner to corner, with their rows and openings, for its lengths (step 2, 2c).
        sides: buildingPlanRoomSides(floor, room, gridSize),
      });
      const faceRows = roomRow.repeatable[key(meta, 'walls')] || [];
      for (const face of room.faces) {
        const faceIndex = faceRows.findIndex((row) => subjectId(meta, 'walls', row) === face.id);
        const faceRow = faceRows[faceIndex];
        const wallPath = [...roomPath, { key: key(meta, 'walls'), index: faceIndex }];
        const physical = floor.walls.find((wall) => wall.id === face.wallId);

        const portions = buildingPlanFaceSegments(floor, room, face).map((part) =>
          part.direction > 0 ? part : { ...part, start: part.end, end: part.start }
        );
        // A jog is a connected polyline. Preserve the binding index for hosted openings.
        const points = portions.flatMap((part, i) =>
          i ? [pixels(part.end)] : [pixels(part.start), pixels(part.end)]
        );
        const axisPoints = buildingPlanFaceAxes(physical, portions, pixels);
        // The face up to the room's corner, over the caps next to it (drawn when selected).
        const extent = faceExtent(
          room,
          face,
          portions.flatMap((part, i) => (i ? [part.end] : [part.start, part.end]))
        );
        const wall = {
          id: face.id,
          physicalWallId: physical.id,
          isBoundary: !face.freePath,
          isCutPortion: Boolean(face.freePath?.some((point) => point.editingCutId)),
          editingGroupId: face.lineage?.editingOriginFaceId || null,
          isEditingReturn: Boolean(face.lineage?.editingReturn),
          rowId: faceRow.id,
          roomId: room.id,
          floorIndex,
          index: faceIndex,
          path: wallPath,
          // A free wall is given by its centreline (4a-3); `sidePoints` is its row's face.
          ...(face.freePath ? { points: axisPoints, sidePoints: points } : { points }),
          ...(extent ? { extentPoints: extent.map(pixels) } : {}),
          axisPoints,
          bindings: copy(face.bindings),
          doors: [],
          windows: [],
          label: physical.values.wall_label || '',
          displayLabel: physical.values.wall_label || physical.autoLabel || `W#${faceIndex + 1}`,
          thickness: physical.properties.wall_thickness,
          height: physical.properties.wall_height,
          plaster: facePlaster(physical, face),
          provenance: copy(physical.provenance),
        };
        output.walls.push(wall);
        for (const collection of ['doors', 'windows']) {
          const projectionName = collection === 'doors' ? 'face_doors' : 'face_windows';
          const projected = faceRow.repeatable?.[key(meta, projectionName)] || [];
          for (const opening of physical[collection]) {
            const bindingIndex = face.bindings.findIndex(
              (binding) =>
                binding.segmentId === opening.segmentId &&
                opening.offset >= binding.interval[0] - 1e-6 &&
                opening.offset + opening.width <= binding.interval[1] + 1e-6
            );
            if (bindingIndex < 0) continue;
            const binding = face.bindings[bindingIndex];
            const span = binding.interval[1] - binding.interval[0];
            const start =
              binding.direction > 0
                ? opening.offset - binding.interval[0]
                : binding.interval[1] - opening.offset - opening.width;
            const projectedIndex = projected.findIndex(
              (row) => subjectId(meta, projectionName, row) === opening.id
            );
            const entry = {
              id: `${face.id}:${opening.id}`,
              subjectId: opening.id,
              wallId: face.id,
              physicalWallId: physical.id,
              roomId: room.id,
              floorIndex,
              index: projectedIndex,
              path: [...wallPath, { key: key(meta, projectionName), index: projectedIndex }],
              segmentIndex: bindingIndex,
              startRatio: start / span,
              endRatio: (start + opening.width) / span,
              width: opening.width,
              height: opening.height,
              distanceFromFloor: opening.sillHeight,
              wallReference: physical.id,
              physical: output.physicalOpenings.find((item) => item.id === opening.id),
              label: opening.values[collection === 'doors' ? 'door_label' : 'window_label'] || '',
              displayLabel: `${collection === 'doors' ? 'D' : 'W'}#${projectedIndex + 1}`,
            };
            output[collection].push(entry);
            wall[collection].push(entry.id);
          }
        }
      }
      for (const collection of ['columns', 'beams']) {
        const rows = roomRow.repeatable?.[key(meta, collection)] || [];
        for (const item of room[collection]) {
          if (
            item.width == null ||
            item.height == null ||
            (collection === 'columns' ? !item.position : !item.start || !item.end)
          )
            continue;
          const index = rows.findIndex((row) => subjectId(meta, collection, row) === item.id);
          const prefix = collection === 'columns' ? 'column' : 'beam';
          const values = item.values || {};
          output[collection].push({
            ...copy(item),
            id: item.id,
            roomId: room.id,
            floorIndex,
            index,
            path: [...roomPath, { key: key(meta, collection), index }],
            width: item.width ?? values[`${prefix}_width`] ?? 0.3,
            height: item.height ?? values[`${prefix}_depth`] ?? 0.3,
            vertical: values.column_height ?? 3,
            centerU: item.position
              ? (item.position.x - bounds.x) / bounds.width
              : (values.column_center_u ?? 0.5),
            centerV: item.position
              ? (item.position.y - bounds.y) / bounds.height
              : (values.column_center_v ?? 0.5),
            startU: item.start
              ? (item.start.x - bounds.x) / bounds.width
              : (values.beam_start_u ?? 0.25),
            startV: item.start
              ? (item.start.y - bounds.y) / bounds.height
              : (values.beam_start_v ?? 0.5),
            endU: item.end ? (item.end.x - bounds.x) / bounds.width : (values.beam_end_u ?? 0.75),
            endV: item.end ? (item.end.y - bounds.y) / bounds.height : (values.beam_end_v ?? 0.5),
            wallSegmentIndex: values[`${prefix}_wall_segment_index`] ?? -1,
            wallRatio: values.column_wall_ratio ?? 0,
            startRatio: values.beam_start_ratio ?? 0,
            endRatio: values.beam_end_ratio ?? 1,
            length: item.start && item.end ? distance(item.start, item.end) : values.beam_length,
            // A beam's outline, its ends cut along the faces they stop on (3a-3, B6).
            ...(collection === 'beams'
              ? {
                  outline: beamOutline(item.start, item.end, item.width / 2, room.vertices).map(
                    pixels
                  ),
                }
              : {}),
            label: values[`${prefix}_identifier`] || '',
            displayLabel:
              values[`${prefix}_identifier`] ||
              `${collection === 'columns' ? 'C' : 'B'}#${index + 1}`,
          });
        }
      }
    }
    // Problems to fix before saving (bands unit 4a), with the rows that show them.
    output.problems = problemRowPaths(buildingPlanProblems(floor), { meta, record, floor });
  }
  // The floor below, drawn under this one (F2); a preview passes the one it has (an edit of this
  // floor doesn't change it).
  output.floorBelow =
    floorBelow !== undefined
      ? floorBelow
      : buildingPlanFloorBelow(plan.floors, plan.floors[activeFloorIndex], gridSize);
  if (output.floorBelow && floorBelow === undefined)
    output.floorBelow.label = output.floors.find(
      (entry) => entry.id === output.floorBelow.id
    )?.label;
  return output;
}

/**
 * Shared canvas rules. Hosts supply record transactions, navigation, and issue presentation.
 * No DOM, framework, lifecycle event, or record persistence belongs in this controller.
 * `derivedCommands` runs the geometry commands on the derived core (see the record session); a
 * host passes the same value to every session of one plan. `floorId`: the floor to show (an
 * entry's own floor; `showFloor` changes it), else the first.
 */
export class BuildingPlanCanvasController {
  constructor({
    meta,
    readRecord,
    writeRecord,
    focusRow = () => {},
    reportIssues = () => {},
    readOnly = false,
    createId = generateUuidV7,
    scopeId = () => null,
    editingPolicy = {},
    confirmOpeningRemoval = () => false,
    managedTransactions = false,
    presentQuestion,
    derivedCommands = false,
    floorId = null,
  }) {
    Object.assign(this, {
      meta,
      readRecord,
      writeRecord,
      focusRow,
      reportIssues,
      readOnly,
      createId,
      scopeId,
      confirmOpeningRemoval,
      managedTransactions,
      presentQuestion,
      derivedCommands,
    });
    this.editingPolicy = normalizeBuildingPlanEditingPolicy(editingPolicy);
    // The floor below's pulls follow the host's switch (step 2, S4): off, the scene the pulls read
    // has no floor below. The snapshot keeps it, for the host to draw or not.
    this.floorBelowPulls = true;
    this.interaction = createBuildingPlanInteraction({
      scene: () => ({
        ...this.getSnapshot(),
        gridSize: this.gridSize,
        ...(this.floorBelowPulls ? {} : { floorBelow: null }),
      }),
      policy: () => this.editingPolicy,
    });
    this.gridSize = 20;
    this.activeFloorIndex = 0;
    // The floor shown, by id, so it stays shown when floors are added or reordered: an entry's own
    // floor (`floorId`, a host's scope), else the one its tabs chose; none, the first.
    this.shownFloorId = floorId;
    this.listeners = new Set();
    this.pinnedFaceIds = new Set();
    this.disposed = false;
    this.busy = false;
    this.syncFromState();
  }
  /**
   * The scope this controller's own session previews in. A managed host commits through its
   * editor, in the entry's scope there; this session only previews, so it keeps a scope of its
   * own opened on the plan it started with, the entry's start (a canvas opens with its entry), for
   * the drags that read it (a shared wall dragged back, `derive/entry-return.js`).
   */
  previewScopeId() {
    return this.managedTransactions ? PREVIEW_SCOPE_ID : this.scopeId();
  }
  syncFromState() {
    if (this.busy || this.disposed) return;
    if (this.pinScopeId !== undefined && this.pinScopeId !== this.scopeId()) {
      this.pinnedFaceIds.clear();
      this.pinScopeId = undefined;
    }
    try {
      const record = this.readRecord();
      const plan = readBuildingPlanRecord({ meta: this.meta, record });
      if (!this.session) {
        this.session = createBuildingPlanSession({
          snapshot: plan,
          properties: this.meta.properties,
          createId: this.createId,
          editingPolicy: this.editingPolicy,
          derivedCommands: this.derivedCommands,
        });
        if (this.managedTransactions) this.session.beginScope({ id: PREVIEW_SCOPE_ID });
      } else {
        const result = this.session.synchronize(plan);
        if (result.issues.length)
          throw Object.assign(new Error(result.issues[0].message), { issues: result.issues });
      }
      this.record = copy(record);
      this.refresh();
    } catch (error) {
      this.reportIssues(error.issues || [{ code: 'invalid_record', message: error.message }]);
    }
  }
  refresh(plan = this.session.getSnapshot(), record = this.record) {
    this.semanticSnapshot = plan;
    const shown = plan.floors.findIndex((floor) => floor.id === this.shownFloorId);
    if (shown >= 0) this.activeFloorIndex = shown;
    this.activeFloorIndex = Math.max(0, Math.min(this.activeFloorIndex, plan.floors.length - 1));
    this.snapshot = buildingPlanCanvasSnapshot({
      meta: this.meta,
      record,
      plan,
      gridSize: this.gridSize,
      activeFloorIndex: this.activeFloorIndex,
      freeWallBends: this.derivedCommands,
    });
    this.floors = this.snapshot.floors;
    this.floorCount = this.floors.length;
    for (const collection of ['rooms', 'walls', 'columns', 'beams', 'doors', 'windows'])
      this[collection] = new Map(this.snapshot[collection].map((item) => [item.id, item]));
    for (const id of this.pinnedFaceIds) if (!this.walls.has(id)) this.pinnedFaceIds.delete(id);
  }
  canEdit() {
    return (
      !this.disposed &&
      !this.busy &&
      !(typeof this.readOnly === 'function' ? this.readOnly() : this.readOnly)
    );
  }
  isBusy() {
    return this.busy;
  }
  getSnapshot() {
    const view = copy({
      ...(this.previewView ||
        this.snapshot || {
          floors: [],
          rooms: [],
          walls: [],
          columns: [],
          beams: [],
          doors: [],
          windows: [],
        }),
      history: this.session?.getState(),
      guides: this.interaction?.getGuides() || [],
    });
    for (const wall of view.walls) wall.pinned = this.pinnedFaceIds.has(wall.id);
    return view;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }
  emitUpdate() {
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
  setGridSize(size) {
    if (Number.isFinite(size) && size > 0) {
      this.gridSize = size;
      if (this.session) this.refresh();
      this.emitUpdate();
    }
  }
  setActiveFloor(index) {
    this.pinnedFaceIds.clear();
    this.activeFloorIndex = index;
    this.shownFloorId = this.semanticSnapshot?.floors[index]?.id ?? null;
    this.refresh();
    this.emitUpdate();
  }
  /**
   * Shows the floor with this id (an entry's own floor), now and when the plan changes; none, or
   * one the plan doesn't have yet, keeps the floor shown.
   * @param {string | null} floorId
   */
  showFloor(floorId) {
    if (floorId === this.shownFloorId) return;
    this.pinnedFaceIds.clear();
    this.shownFloorId = floorId;
    if (this.session) this.refresh();
    this.emitUpdate();
  }
  getActiveFloorPath() {
    return this.floors[this.activeFloorIndex]?.path || [];
  }
  getActiveFloor() {
    return this.floors[this.activeFloorIndex] || null;
  }
  dispose() {
    this.disposed = true;
    this.session?.cancelUIRequests();
    this.listeners.clear();
    this.interaction.reset();
    this.pinnedFaceIds.clear();
  }
  setEditingPolicy(policy) {
    this.editingPolicy = normalizeBuildingPlanEditingPolicy(policy);
    this.session?.setEditingPolicy(this.editingPolicy);
    this.interaction.reset();
    this.emitUpdate();
  }
  async settleFieldUpdates() {
    return this.pending;
  }
  get floorId() {
    return this.floors[this.activeFloorIndex]?.id;
  }
  async apply(operation) {
    if (!this.canEdit() || !this.session) return null;
    this.syncFromState();
    operation = {
      ...operation,
      pinnedFaceIds: [...this.pinnedFaceIds],
      thicknessAnchor: operation.thicknessAnchor ?? this.editingPolicy.thicknessAnchor,
    };
    this.previewView = null;
    let proposal = this.session.preview(operation, { scopeId: this.previewScopeId() });
    const cut = proposal.issues?.find(
      (issue) => issue.code === 'opening_cut_requires_confirmation'
    );
    if (cut) {
      const before = JSON.stringify(this.readRecord());
      this.busy = true;
      this.emitUpdate();
      let confirmed;
      try {
        confirmed = await this.confirmOpeningRemoval(copy(cut));
      } finally {
        this.busy = false;
        this.emitUpdate();
      }
      if (this.disposed || !this.canEdit() || JSON.stringify(this.readRecord()) !== before)
        return null;
      if (!confirmed) {
        this.reportIssues(proposal.issues);
        return null;
      }
      operation = {
        ...operation,
        removeOpeningIds: cut.openingIds,
      };
      proposal = this.session.preview(operation, { scopeId: this.previewScopeId() });
    }

    if (proposal.status !== 'ready') {
      this.reportIssues(proposal.issues);
      this.emitUpdate();
      return null;
    }
    this.busy = true;
    this.emitUpdate();
    const before = this.session.getSnapshot();
    const observedRecord = JSON.stringify(this.readRecord());
    let committed = null;
    try {
      if (!this.managedTransactions) {
        committed = await settleBuildingPlanQuestions(
          this.session,
          this.session.commit(proposal),
          typeof this.presentQuestion === 'function'
            ? async (question, lifetime) => {
                const response = await this.presentQuestion(question, {
                  ...lifetime,
                  isCurrent: () =>
                    lifetime.isCurrent() &&
                    !this.disposed &&
                    observedRecord === JSON.stringify(this.readRecord()),
                });
                if (this.disposed || observedRecord !== JSON.stringify(this.readRecord()))
                  this.session.cancelUIRequests();
                return response;
              }
            : undefined
        );
        if (
          this.disposed ||
          (typeof this.readOnly === 'function' ? this.readOnly() : this.readOnly) ||
          committed.status !== 'applied'
        ) {
          this.session.synchronize(before);
          this.reportIssues(committed.issues || []);
          return null;
        }
      }
      // Managed hosts commit the operation themselves and ask its questions there, so the proposal
      // may still hold them; the host's result (its record, or 'pending') replaces this one.
      const next = (
        this.managedTransactions ? writeBuildingPlanPreviewRecord : writeBuildingPlanRecord
      )({
        meta: this.meta,
        record: this.record,
        plan: committed?.snapshot || proposal.snapshot,
      });
      this.pending = Promise.resolve(
        this.writeRecord(next, { operation, proposal, floorId: operation.floorId })
      );
      const accepted = await this.pending;
      if (
        this.disposed ||
        accepted === false ||
        accepted?.issues?.length ||
        accepted?.status === 'pending' ||
        accepted?.status === 'cancelled' ||
        accepted?.status === 'unchanged' ||
        accepted?.status === 'conflict'
      ) {
        if (committed) this.session.synchronize(before);
        if (accepted?.issues) this.reportIssues(accepted.issues);
        return null;
      }
      let result = committed;
      if (accepted?.record) {
        const synchronized = this.session.synchronize(
          readBuildingPlanRecord({ meta: this.meta, record: accepted.record })
        );
        result = {
          ...accepted,
          status: synchronized.status === 'synchronized' ? 'applied' : 'conflict',
          issues: synchronized.issues,
        };
      } else if (!result) result = this.session.commit(proposal);
      if (result.status !== 'applied') {
        this.reportIssues(result.issues);
        return null;
      }
      this.record = accepted?.record || next;
      this.refresh();
      this.reportIssues([]);
      const created = result.createdFace || result.created;
      if (created)
        return (
          [
            ...this.floors,
            ...this.rooms.values(),
            ...this.walls.values(),
            ...this.columns.values(),
            ...this.beams.values(),
            ...this.doors.values(),
            ...this.windows.values(),
          ].find((entry) => entry.id === created.id || entry.subjectId === created.id) || created
        );
      return result;
    } catch (error) {
      // Hosts apply from pointer handlers: a throw here left the drag attached to the pointer
      // (web retest 2026-11-16). Report it and follow the host's record again.
      this.busy = false;
      this.syncFromState();
      this.reportIssues(error.issues || [{ code: 'invalid_operation', message: error.message }]);
      return null;
    } finally {
      this.busy = false;
      this.pending = null;
      this.emitUpdate();
    }
  }
  fieldState(path, name) {
    return getBuildingPlanFieldState(this.meta, this.record, this.semanticSnapshot, path, name);
  }
  /**
   * Whether drawing and dragging pull to the floor below (F3): on by default; a host turns it off
   * with the floor below's switch (step 2, S4). Every pull reads the floor below from the
   * interaction's scene, so all of them follow.
   * @param {boolean} on
   */
  setFloorBelowPulls(on) {
    this.floorBelowPulls = on !== false;
    this.interaction.reset();
  }
  metric(point) {
    return { x: point.x / this.gridSize, y: point.y / this.gridSize };
  }
  previewOperation(operation) {
    if (!this.canEdit() || !this.session) return { status: 'blocked', issues: [] };
    const proposal = this.session.preview(
      {
        ...operation,
        pinnedFaceIds: [...this.pinnedFaceIds],
        thicknessAnchor: operation.thicknessAnchor ?? this.editingPolicy.thicknessAnchor,
      },
      { scopeId: this.previewScopeId() }
    );
    if (proposal.status !== 'ready') {
      this.reportIssues(proposal.issues);
      return proposal;
    }
    // Hosts preview from pointer handlers, and the drop handler previews first: a preview that
    // threw lost the drop (web retest 2026-11-16). It reports instead and keeps the last preview.
    let previewView;
    try {
      previewView = buildingPlanCanvasSnapshot({
        meta: this.meta,
        record: writeBuildingPlanPreviewRecord({
          meta: this.meta,
          record: this.record,
          plan: proposal.snapshot,
        }),
        plan: proposal.snapshot,
        gridSize: this.gridSize,
        activeFloorIndex: this.activeFloorIndex,
        freeWallBends: this.derivedCommands,
        floorBelow: this.snapshot?.floorBelow ?? null,
      });
    } catch (error) {
      const issues = error.issues || [{ code: 'invalid_preview', message: error.message }];
      this.reportIssues(issues);
      return { status: 'conflict', issues };
    }
    this.previewView = previewView;
    this.reportIssues([]);
    this.emitUpdate();
    return proposal;
  }
  clearPreview({ clearIssues = false } = {}) {
    this.previewView = null;
    this.interaction.reset();
    if (clearIssues) this.reportIssues([]);
    this.emitUpdate();
  }
  createFloor(values = {}) {
    return this.apply({ type: 'create_floor', values });
  }
  createRoom(rect) {
    return this.apply({
      type: 'create_room',
      attach: true,
      attachmentTolerance: 0.25,
      floorId: this.floorId,
      rectangle: {
        ...this.metric(rect),
        width: rect.width / this.gridSize,
        height: rect.height / this.gridSize,
      },
    });
  }
  updateRoom(id, rect) {
    const operation = this.roomOperation(id, rect);
    return operation && this.apply(operation);
  }
  previewRoom(id, rect) {
    const operation = this.roomOperation(id, rect);
    return operation && this.previewOperation(operation);
  }
  roomOperation(id, rect) {
    const room = this.rooms.get(id);
    if (!room) return null;
    // A drag that keeps the size within 1 mm is a move (hosts round the dragged rectangle).
    const tolerance = this.gridSize * 1e-3;
    const sameSize =
      Math.abs(rect.width - room.rect.width) < tolerance &&
      Math.abs(rect.height - room.rect.height) < tolerance;
    return sameSize
      ? {
          type: 'move_room',
          attach: true,
          attachmentTolerance: 0.25,
          floorId: this.floorId,
          roomId: id,
          delta: this.metric({ x: rect.x - room.rect.x, y: rect.y - room.rect.y }),
        }
      : {
          type: 'resize_room',
          floorId: this.floorId,
          roomId: id,
          rectangle: {
            ...this.metric(rect),
            width: rect.width / this.gridSize,
            height: rect.height / this.gridSize,
          },
        };
  }
  /** A free wall drawn by its centreline (4a-3): the row keeps the face it lies along. */
  createWall(roomId, points) {
    const floor = this.session?.getSnapshot().floors.find((entry) => entry.id === this.floorId);
    const width = newFreeWallWidth(floor, roomId, this.meta.properties);
    return this.apply({
      type: 'create_wall',
      floorId: this.floorId,
      roomId,
      vertices: newFreeWallFace(
        points.map((p) => this.metric(p)),
        width
      ),
    });
  }
  getCornerPlacement(point, { roomId, preferredRoomId, zoom = 1 } = {}) {
    const corner = (this.snapshot.corners || [])
      .filter(
        (corner) =>
          (!roomId || corner.roomId === roomId) && distance(corner.point, point) * zoom <= 9
      )
      .sort(
        (a, b) =>
          Number(b.roomId === preferredRoomId) - Number(a.roomId === preferredRoomId) ||
          distance(a.point, point) - distance(b.point, point)
      )[0];
    if (!corner) return null;
    // Reserve the centre of short portions for wall selection: adjacent vertex handles
    // otherwise cover the entire return at ordinary zoom levels.
    const wallCentre = this.snapshot.walls.some((wall) => {
      if (wall.roomId !== corner.roomId || wall.points.length !== 2) return false;
      const frame = segmentFrame(...wall.points),
        value = project(frame, point);
      return (
        frame.length * zoom < 18 &&
        value.along / frame.length > 0.25 &&
        value.along / frame.length < 0.75 &&
        Math.abs(value.offset) * zoom <= 3
      );
    });
    return wallCentre ? null : copy(corner);
  }
  toggleWallPin(id) {
    if (!this.canEdit() || !this.walls.has(id)) return false;
    this.pinScopeId = this.scopeId();
    if (this.pinnedFaceIds.has(id)) this.pinnedFaceIds.delete(id);
    else this.pinnedFaceIds.add(id);
    this.emitUpdate();
    return true;
  }
  previewCorner(roomId, vertexId, point) {
    return this.previewOperation({
      ...this.cornerOperation(roomId, vertexId),
      point: this.metric(point),
    });
  }
  updateCorner(roomId, vertexId, point) {
    return this.apply({ ...this.cornerOperation(roomId, vertexId), point: this.metric(point) });
  }
  /** A room corner moves; a free wall's split point bends the wall (4a-4). */
  cornerOperation(roomId, vertexId) {
    const bend = (this.snapshot.corners || []).find((corner) => corner.id === vertexId)?.freeWall;
    return bend
      ? { type: 'move_free_wall_point', floorId: this.floorId, roomId, cutId: bend.cutId }
      : { type: 'move_corner', floorId: this.floorId, roomId, vertexId };
  }
  updateWall(id, points) {
    const operation = this.wallOperation(id, points);
    return operation && this.apply(operation);
  }
  previewWall(id, points) {
    const operation = this.wallOperation(id, points);
    return operation && this.previewOperation(operation);
  }
  getCutPlacement(point, options = {}) {
    return buildingPlanCutPlacement({ ...this.snapshot, gridSize: this.gridSize }, point, {
      snapping: this.editingPolicy.snapping,
      ...options,
    });
  }
  getJoinPlacement(point, options = {}) {
    return buildingPlanJoinPlacement(this.snapshot, point, options);
  }
  splitWall(id, { offset } = {}) {
    return this.apply({ type: 'split_face', floorId: this.floorId, faceId: id, offset });
  }
  rejoinCut(id) {
    return this.apply({ type: 'rejoin_cut', floorId: this.floorId, cutId: id });
  }
  wallOperation(id, points) {
    const info = this.walls.get(id);
    if (!info) return null;
    const floor = this.session.getSnapshot().floors.find((entry) => entry.id === this.floorId);
    const room = floor.rooms.find((entry) => entry.id === info.roomId);
    const face = room.faces.find((entry) => entry.id === id);
    // A free wall moves by its centreline (4a-3); its row's face keeps its side and distance.
    if (face.freePath)
      return {
        type: 'update_wall',
        faceId: id,
        floorId: floor.id,
        wallId: face.wallId,
        vertices: offsetLine(
          points.map((p) => this.metric(p)),
          freeWallSideDistance(
            info.points.map((p) => this.metric(p)),
            info.sidePoints?.map((p) => this.metric(p))
          )
        ),
      };
    const binding = face.bindings[0];
    const old = segmentFrame(this.metric(info.points[0]), this.metric(info.points[1]));
    const offsets = points.map(
      (point, index) =>
        project(old, this.metric(point)).offset -
        project(old, this.metric(info.points[index] || info.points[0])).offset
    );
    const delta = offsets.reduce(
      (selected, value) => (Math.abs(value) > Math.abs(selected) ? value : selected),
      0
    );
    // The direction of an outward displacement follows the room's actual winding.
    return {
      type: 'resize_face',
      floorId: floor.id,
      faceId: id,
      edgeId: binding.edgeId,
      distance: -Math.sign(polygonArea(room.vertices)) * delta,
    };
  }
  createColumn(roomId, values = {}) {
    return this.element('columns', roomId, null, values);
  }
  updateColumn(id, values = {}) {
    return this.element('columns', this.columns.get(id)?.roomId, id, values);
  }
  createBeam(roomId, values = {}) {
    return this.element('beams', roomId, null, values);
  }
  updateBeam(id, values = {}) {
    return this.element('beams', this.beams.get(id)?.roomId, id, values);
  }
  previewElement(collection, id, updates) {
    return this.element(collection, this[collection]?.get(id)?.roomId, id, updates, true);
  }
  element(collection, roomId, id, updates, preview = false) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const old = id ? this[collection].get(id) : {};
    const input = { ...old, ...updates };
    const bounds = {
      ...this.metric(room.rect),
      width: room.rect.width / this.gridSize,
      height: room.rect.height / this.gridSize,
    };
    const point = (u, v) => ({ x: bounds.x + u * bounds.width, y: bounds.y + v * bounds.height });
    const prefix = collection === 'columns' ? 'column' : 'beam';
    const values = {
      ...(old.values || {}),
      [`${prefix}_identifier`]: input.label ?? '',
      [`${prefix}_width`]: input.width ?? 0.3,
      [`${prefix}_depth`]: input.height ?? 0.3,
      [`${prefix}_wall_segment_index`]: input.wallSegmentIndex ?? -1,
    };
    let shape;
    if (collection === 'columns') {
      Object.assign(values, {
        column_center_u: input.centerU ?? 0.5,
        column_center_v: input.centerV ?? 0.5,
        column_height: input.vertical ?? 3,
        column_wall_ratio: input.wallRatio ?? 0,
      });
      shape = {
        position: point(values.column_center_u, values.column_center_v),
        width: values.column_width,
        height: values.column_depth,
        rotation: input.rotation ?? 0,
      };
    } else {
      Object.assign(values, {
        beam_start_u: input.startU ?? 0.25,
        beam_start_v: input.startV ?? 0.5,
        beam_end_u: input.endU ?? 0.75,
        beam_end_v: input.endV ?? 0.5,
        beam_start_ratio: input.startRatio ?? 0,
        beam_end_ratio: input.endRatio ?? 1,
      });
      shape = {
        start: point(values.beam_start_u, values.beam_start_v),
        end: point(values.beam_end_u, values.beam_end_v),
        width: values.beam_width,
        height: values.beam_depth,
      };
      values.beam_length = distance(shape.start, shape.end);
    }
    return this[preview ? 'previewOperation' : 'apply']({
      type: id ? 'update_element' : 'create_element',
      floorId: this.floorId,
      roomId,
      collection,
      ...(id ? { elementId: id } : {}),
      element: { ...shape, values },
      values,
    });
  }
  createDoor(faceId, options) {
    return this.opening('door', faceId, null, options);
  }
  createWindow(faceId, options) {
    return this.opening('window', faceId, null, options);
  }
  updateDoor(id, options) {
    const entry = this.doors.get(id);
    return entry && this.opening('door', entry.wallId, entry, options);
  }
  updateWindow(id, options) {
    const entry = this.windows.get(id);
    return entry && this.opening('window', entry.wallId, entry, options);
  }
  previewOpening(collection, id, updates) {
    const entry = this[collection]?.get(id);
    return (
      entry &&
      this.opening(collection === 'doors' ? 'door' : 'window', entry.wallId, entry, updates, true)
    );
  }
  opening(kind, faceId, previous, options = {}, preview = false) {
    const wall = this.walls.get(faceId);
    if (!wall) return null;
    const input = { ...(previous || {}), ...options };
    const binding = wall.bindings[input.segmentIndex ?? 0];
    if (!binding) return null;
    const span = binding.interval[1] - binding.interval[0];
    // Canvas ratios carry float noise into metres: the stored width and distance from the wall
    // start are kept to the millimetre, inside this room side's portion of the wall.
    const mm = (value) => Math.round(value * 1000) / 1000;
    const width = mm(
      options.width ??
        previous?.width ??
        ((input.endRatio ?? 0.5) - (input.startRatio ?? 0.2)) * span
    );
    const offset = Math.max(
      binding.interval[0],
      Math.min(
        mm(
          binding.direction > 0
            ? binding.interval[0] + (input.startRatio ?? 0.2) * span
            : binding.interval[1] - (input.startRatio ?? 0.2) * span - width
        ),
        binding.interval[1] - width
      )
    );
    return this[preview ? 'previewOperation' : 'apply']({
      type: previous ? 'update_opening' : 'create_opening',
      floorId: this.floorId,
      wallId: wall.physicalWallId,
      ...(previous ? { openingId: previous.subjectId } : { kind }),
      segmentId: binding.segmentId,
      offset,
      width,
      height: input.height ?? (kind === 'door' ? 2 : 1.2),
      sillHeight: input.distanceFromFloor ?? (kind === 'window' ? 0.9 : null),
      values: { [`${kind}_label`]: input.label || '' },
    });
  }
  focus(collection, id) {
    const entry =
      collection === 'floors'
        ? this.floors.find((floor) => floor.id === id)
        : this[collection].get(id);
    if (entry) this.focusRow(copy(entry.path), { collection, id });
  }
  focusRoom(id) {
    this.focus('rooms', id);
  }
  focusWall(id) {
    this.focus('walls', id);
  }
  focusColumn(id) {
    this.focus('columns', id);
  }
  focusBeam(id) {
    this.focus('beams', id);
  }
  focusDoor(id) {
    this.focus('doors', id);
  }
  focusWindow(id) {
    this.focus('windows', id);
  }
}
