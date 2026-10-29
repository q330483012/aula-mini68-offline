using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

// Reads the default playback endpoint's volume meter. No microphone or audio files.
class AudioMeter
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class Enumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDeviceEnumerator
    {
        int EnumAudioEndpoints(int flow, uint state, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
        int GetDevice(string id, out IDevice device);
        int RegisterEndpointNotificationCallback(IntPtr callback);
        int UnregisterEndpointNotificationCallback(IntPtr callback);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDevice
    {
        [PreserveSig] int Activate(ref Guid id, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object result);
        int OpenPropertyStore(uint access, out IntPtr store);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out uint state);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMeter
    {
        [PreserveSig] int GetPeakValue(out float peak);
        int GetMeteringChannelCount(out uint count);
        int GetChannelsPeakValues(uint count, IntPtr values);
        int QueryHardwareSupport(out uint mask);
    }

    [MTAThread]
    static int Main(string[] args)
    {
        var enumerator = (IDeviceEnumerator)new Enumerator();
        IDevice device = null;
        IMeter meter = null;
        int ticks = 0;
        int maximum = args.Length > 0 ? int.Parse(args[0], CultureInfo.InvariantCulture) : int.MaxValue;
        try
        {
            while (ticks < maximum)
            {
                bool available = false;
                float peak = 0;
                try
                {
                    if (ticks % 20 == 0 || meter == null)
                    {
                        if (meter != null) Marshal.ReleaseComObject(meter);
                        if (device != null) Marshal.ReleaseComObject(device);
                        meter = null; device = null;
                        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) == 0)
                        {
                            var iid = typeof(IMeter).GUID;
                            object instance;
                            if (device.Activate(ref iid, 23, IntPtr.Zero, out instance) == 0) meter = (IMeter)instance;
                        }
                    }
                    available = meter != null && meter.GetPeakValue(out peak) == 0;
                }
                catch (COMException) { available = false; }
                int amplitude = available ? (int)Math.Round(Math.Max(0, Math.Min(1, peak)) * 1000) : 0;
                Console.WriteLine("{\"amplitude\":" + amplitude + ",\"available\":" + (available ? "true" : "false") + "}");
                Console.Out.Flush();
                ticks++;
                if (ticks < maximum) Thread.Sleep(50);
            }
            return 0;
        }
        catch (System.IO.IOException) { return 0; }
        finally
        {
            if (meter != null) Marshal.ReleaseComObject(meter);
            if (device != null) Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
    }
}
