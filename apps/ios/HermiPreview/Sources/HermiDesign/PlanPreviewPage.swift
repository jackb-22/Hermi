import SwiftUI

struct PlanPreviewPage: View {
  @Binding var state: MapPreviewState
  var saved: Bool
  var close: () -> Void
  var go: () -> Void
  private var times: [String: PreviewStopTime] { state.stopTimes ?? [:] }
  @State private var editor: MapSamplePlace?
  @State private var participants: MapSamplePlace?
  @State private var help = false
  @State private var compact = false
  private var warning: Bool { !state.timingConflicts.isEmpty }
  var body: some View {
    VStack(spacing: 16) {
      Capsule().fill(HermiPalette.secondary.opacity(0.5)).frame(width: 36, height: 4).padding(.top, 10)
        .frame(height: 24).frame(maxWidth: .infinity).contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 10).exclusively(before: TapGesture()).onEnded { gesture in
          switch gesture {
          case .first(let drag):
            if abs(drag.translation.height) > 30 && abs(drag.translation.height) > abs(drag.translation.width) { compact = drag.translation.height > 0 }
          case .second: compact.toggle()
          }
        })
        .accessibilityLabel(compact ? "Expand My Plan to full page" : "Collapse My Plan")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { compact.toggle() }
      HStack {
        Button { close() } label: { PixelIcon(name: "close").frame(width: 20, height: 20).frame(width: 44, height: 44) }
          .accessibilityLabel("Close planning").controlHelp("Close planning and return to your previous page")
        Text(saved ? "Saved" : "My Plan").font(.title2.bold())
        Spacer()
        Button { state.sheet = saved ? .plan : .saved } label: {
          PixelIcon(name: saved ? "saved" : "save").frame(width: 22, height: 26).frame(width: 44, height: 44)
        }.accessibilityLabel(saved ? "Return to My Plan" : "Open Saved")
          .controlHelp(saved ? "Close Saved and return to My Plan" : "Open saved places without changing My Plan")
      }.padding(.horizontal, 16)
      if saved { savedList }
      else {
        HStack {
          Button { help.toggle() } label: { PixelIcon(name: "clock").frame(width: 24, height: 24).frame(width: 44, height: 44) }
            .accessibilityLabel("Timeline help").controlHelp("Tap a time to edit. Hold a stop and move it to reorder")
          Text("Hold a stop to reorder").font(.caption).foregroundStyle(HermiPalette.secondary)
          Spacer()
        }.padding(.horizontal, 18)
        if help { Text("Set arrival, stay length and a reminder preference for each place. Reminders are not scheduled in preview.").font(.caption).padding(.horizontal, 20) }
        ScrollView {
          LazyVStack(spacing: 12) {
            if state.planIDs.isEmpty {
              Text("Add a place from Map, Feed or Saved.").font(.subheadline).padding(24)
            }
            ForEach(state.planIDs, id: \.self) { id in
              if let place = MapSamplePlace.find(id) { stopRow(place) }
            }
          }.padding(.horizontal, 18).padding(.vertical, 8)
        }
        if warning {
          Text("Some stops overlap or run backwards. Edit their times or continue with Go!")
            .font(.caption).foregroundStyle(HermiPalette.ink).padding(12)
            .background(HermiPalette.coral.opacity(0.25), in: PixelPanel(corner: 6)).padding(.horizontal, 18)
        }
        Button { if state.canStartPlan { go() } } label: {
          Text("Go!").font(.title2.bold()).frame(width: 130, height: 62)
            .background(HermiPalette.lime, in: PixelPanel(corner: 18))
        }.disabled(!state.canStartPlan).opacity(state.canStartPlan ? 1 : 0.45)
          .accessibilityHint("Opens Action preview. No real trip, tracking or notifications begin")
          .controlHelp(!state.canStartPlan ? "Add at least one place before Go" : "Enter Action preview: Directions and Camera")
        Text("Local plan preview · reminders and invitations are not sent")
          .font(.caption2).foregroundStyle(HermiPalette.secondary).padding(.horizontal, 18)
      }
    }
    .buttonStyle(.plain)
    .padding(.bottom, 115)
    .frame(maxWidth: .infinity)
    .frame(maxHeight: compact ? 560 : .infinity)
    .background(HermiPalette.paper, in: UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20))
    .frame(maxHeight: .infinity, alignment: .bottom)
    .onAppear {
      // Migrate old preview drafts once into the durable plan snapshot.
      if state.stopTimes == nil {
        let data = UserDefaults.standard.data(forKey: "hermi.preview.stopTimes")
        let old = data.flatMap { try? JSONDecoder().decode([String: PreviewStopTime].self, from: $0) } ?? [:]
        state.stopTimes = old.filter { state.planIDs.contains($0.key) && $0.value.isValid }
      }
      if state.stopInviteDrafts == nil {
        state.stopInviteDrafts = Dictionary(uniqueKeysWithValues: state.planIDs.map {
          ($0, Set(UserDefaults.standard.stringArray(forKey: "hermi.preview.invites.\($0)") ?? []))
        })
      }
    }
    .sheet(item: $editor) { place in
      StopTimeEditor(place: place, value: times[place.id]) { state.setStopTime($0, for: place.id) }
    }
    .sheet(item: $participants) { place in
      ParticipantPreview(place: place, initialSelection: state.stopInviteDrafts?[place.id] ?? [], save: {
        state.setInviteDraft($0, for: place.id)
      }, remove: { state.removePlace(place.id) })
    }
  }

  private func stopRow(_ place: MapSamplePlace) -> some View {
    HStack(spacing: 10) {
      Button { editor = place } label: {
        VStack(spacing: 5) {
          if let time = times[place.id] {
            Text(time.arrival, format: .dateTime.month(.abbreviated).day()).font(.system(size: 9))
            Text(time.arrival, style: .time).font(.caption.bold())
            Text("\(time.durationMinutes)m" + (time.reminderMinutes > 0 ? " · \(time.reminderMinutes)m before" : "")).font(.system(size: 9)).lineLimit(2)
          } else { Text("Set time").font(.caption) }
        }.frame(width: 64, height: 58)
      }.accessibilityLabel("Edit time for \(place.name)")
        .controlHelp("Edit arrival, duration and reminder for \(place.name)")
      Rectangle().fill(HermiPalette.green.opacity(0.4)).frame(width: 2, height: 58)
      HStack(spacing: 4) {
        Button { state.selectPlace(place.id) } label: {
          Text(place.name).font(.subheadline).frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        }.help("Open place details. Hold and drag this row to reorder")
        Button { participants = place } label: { PixelIcon(name: "menu").frame(width: 22, height: 16).frame(width: 44, height: 48) }
          .accessibilityLabel("Who's going to \(place.name)")
          .controlHelp("View attendees and choose existing friends to invite")
      }.padding(.leading, 12).background(HermiPalette.lime.opacity(0.35), in: Capsule())
        .draggable(place.id) { Text("Move \(place.name)").padding(12).background(HermiPalette.lime) }
        .dropDestination(for: String.self) { ids, point in
          guard let id = ids.first, state.planIDs.contains(id) else { return false }
          state.movePlace(id, relativeTo: place.id, after: point.y > 27); return true
        }
        .accessibilityAction(named: "Move earlier") {
          if let index = state.planIDs.firstIndex(of: place.id), index > 0 { state.movePlace(place.id, before: state.planIDs[index-1]) }
        }
        .accessibilityAction(named: "Move later") {
          if let index = state.planIDs.firstIndex(of: place.id), index+1 < state.planIDs.count { state.planIDs.swapAt(index, index+1) }
        }
    }
  }
  private var savedList: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        if state.savedIDs.isEmpty { Text("No saved places yet.").padding(20) }
        ForEach(HermiCategory.allCases, id: \.self) { category in
          let places = MapSamplePlace.all.filter { $0.category == category && state.savedIDs.contains($0.id) }
          if !places.isEmpty {
            Text(category.rawValue).font(.caption.bold()).foregroundStyle(HermiPalette.secondary)
            ForEach(places) { place in
              HStack {
                Button(place.name) { state.selectPlace(place.id) }.frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                  .controlHelp("Open saved place \(place.name)")
                Button { state.togglePlan(place.id) } label: { PixelIcon(name: state.planIDs.contains(place.id) ? "check" : "plus").frame(width: 20, height: 20).frame(width: 44, height: 44) }
                  .accessibilityLabel(state.planIDs.contains(place.id) ? "Remove \(place.name) from plan" : "Add \(place.name) to plan")
                  .controlHelp("Toggle this saved place in My Plan; keep it saved")
              }.padding(.horizontal, 14).background(HermiPalette.lime.opacity(0.25), in: Capsule())
            }
          }
        }
      }.padding(20)
    }
  }
}

private struct StopTimeEditor: View {
  let place: MapSamplePlace
  var save: (PreviewStopTime?) -> Void
  @State private var draft: PreviewStopTime
  @Environment(\.dismiss) private var dismiss
  init(place: MapSamplePlace, value: PreviewStopTime?, save: @escaping (PreviewStopTime?) -> Void) {
    self.place = place; self.save = save
    _draft = State(initialValue: value ?? PreviewStopTime(arrival: Date().addingTimeInterval(3600)))
  }
  var body: some View {
    NavigationStack {
      Form {
        DatePicker("Arrival", selection: $draft.arrival)
        Stepper("Stay: \(draft.durationMinutes) minutes", value: $draft.durationMinutes, in: 5...1440, step: 5)
        Picker("Remind me", selection: $draft.reminderMinutes) {
          Text("Off").tag(0); Text("5 minutes before").tag(5); Text("15 minutes before").tag(15); Text("30 minutes before").tag(30)
        }
        Text("Preview preference only. Notifications are not scheduled.").font(.caption)
        Button("Clear time", role: .destructive) { save(nil); dismiss() }
      }.scrollContentBackground(.hidden).background(HermiPalette.paper).navigationTitle(place.name)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.controlHelp("Discard time edits") }
          ToolbarItem(placement: .confirmationAction) { Button("Save") { save(draft); dismiss() }.controlHelp("Save this stop's local time and reminder preference") }
        }
    }
  }
}
private struct ParticipantPreview: View {
  let place: MapSamplePlace
  let initialSelection: Set<String>
  var save: (Set<String>) -> Void
  var remove: () -> Void
  @State private var selected: Set<String> = []
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      Form {
        Section("Who's going") { Text("No confirmed attendees loaded.") }
        Section("Invite existing friends · sample list") {
          ForEach(["Alex", "Sam", "Riley"], id: \.self) { name in
            Toggle(name, isOn: Binding(get: { selected.contains(name) }, set: { if $0 { selected.insert(name) } else { selected.remove(name) } }))
          }
        }
        Text("Draft only. Saving this preview list sends no invitations and does not confirm attendance.").font(.caption)
        Section {
          Button("Remove stop from plan", role: .destructive) { remove(); dismiss() }
        }
      }.scrollContentBackground(.hidden).background(HermiPalette.paper).navigationTitle(place.name)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) { Button("Save draft") {
            save(selected); dismiss()
          } }
        }
    }.tint(HermiPalette.green).onAppear { selected = initialSelection }
  }
}
