//
//  AudioRecordingService.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import Foundation
import AVFoundation

class AudioRecordingService: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var recordedFileURL: URL?
    @Published var recordedFileSize: Int64 = 0
    
    private var audioRecorder: AVAudioRecorder?
    
    func startRecording(completion: @escaping (String?) -> Void) {
        // Request permission
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                if !granted {
                    completion("Microphone permission denied")
                    return
                }
                
                self.setupRecording(completion: completion)
            }
        }
    }
    
    private func setupRecording(completion: @escaping (String?) -> Void) {
        let audioSession = AVAudioSession.sharedInstance()
        
        do {
            try audioSession.setCategory(.playAndRecord, mode: .default)
            try audioSession.setActive(true)
            
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let audioFilename = documentsPath.appendingPathComponent("recording_\(Date().timeIntervalSince1970).m4a")
            
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100.0,
                AVNumberOfChannelsKey: 2,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            
            audioRecorder = try AVAudioRecorder(url: audioFilename, settings: settings)
            audioRecorder?.delegate = self
            audioRecorder?.record()
            
            isRecording = true
            recordedFileURL = audioFilename
            completion(nil)
            
        } catch {
            completion("Failed to start recording: \(error.localizedDescription)")
        }
    }
    
    func stopRecording() {
        audioRecorder?.stop()
        isRecording = false
        
        if let url = recordedFileURL {
            do {
                let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
                recordedFileSize = attributes[.size] as? Int64 ?? 0
            } catch {
                print("Failed to get file size: \(error)")
            }
        }
    }
    
    func discardRecording() {
        if let url = recordedFileURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordedFileURL = nil
        recordedFileSize = 0
    }
}

extension AudioRecordingService: AVAudioRecorderDelegate {
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        if !flag {
            print("Recording failed")
        }
    }
}