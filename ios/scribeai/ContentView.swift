//
//  ContentView 2.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    
    var body: some View {
        Group {
            if authViewModel.isAuthenticated {
                HomeView()
            } else {
                LoginView()
            }
        }
    }
}