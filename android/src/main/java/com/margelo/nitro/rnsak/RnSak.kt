package com.margelo.nitro.rnsak
  
import com.facebook.proguard.annotations.DoNotStrip

@DoNotStrip
class RnSak : HybridRnSakSpec() {
  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }
}
